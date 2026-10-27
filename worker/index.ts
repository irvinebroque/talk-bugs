import { DurableObject } from "cloudflare:workers";
import { MAX_HISTORY, MAX_MEMBERS, RETENTION_MS, UUID, parseTranscript,
  type Message, type Participant, type ServerEvent } from "../shared/protocol";

type Attachment = { speaker: Participant; windowStart: number; count: number; closed?: boolean };
type Row = { id: string; speaker: string; utterance: string; revision: number; text: string;
  status: Message["status"]; ordinal: number; started: number; updated: number };
const STALE_MS = 45_000;

export class ChatRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS members (ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        speaker TEXT NOT NULL, utterance TEXT NOT NULL, revision INTEGER NOT NULL,
        text TEXT NOT NULL, status TEXT NOT NULL, started INTEGER NOT NULL, updated INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_updated ON messages(updated);
    `);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter(ws => !this.attachment(ws).closed);
  }

  private attachment(ws: WebSocket): Attachment { return ws.deserializeAttachment() as Attachment; }

  private participant(id: string): Participant {
    const existing = this.ctx.storage.sql.exec<{ ordinal: number }>("SELECT ordinal FROM members WHERE id = ?", id).toArray()[0];
    const { ordinal } = existing ?? this.ctx.storage.sql.exec<{ ordinal: number }>("INSERT INTO members (id) VALUES (?) RETURNING ordinal", id).one();
    return { id, name: `Participant ${ordinal}`, color: (ordinal - 1) % 6 };
  }

  private message(row: Row): Message {
    return { id: row.id, utteranceId: row.utterance, speaker: this.participant(row.speaker),
      revision: row.revision, text: row.text, status: row.status,
      order: row.ordinal, startedAt: row.started, updatedAt: row.updated };
  }

  private send(ws: WebSocket, event: ServerEvent): void {
    try { ws.send(JSON.stringify(event)); } catch { this.disconnect(ws); }
  }

  private broadcast(event: ServerEvent): void {
    for (const ws of this.sockets()) this.send(ws, event);
  }

  private presence(): Participant[] { return this.sockets().map(ws => this.participant(this.attachment(ws).speaker.id)); }

  async fetch(request: Request): Promise<Response> {
    const id = request.headers.get("x-speaker-id");
    if (!id || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket required", { status: 426 });
    const existing = this.sockets().find(ws => this.attachment(ws).speaker.id === id);
    if (!existing && this.sockets().length >= MAX_MEMBERS) return new Response("This room is full (24 people).", { status: 503 });
    if (existing) {
      const a = this.attachment(existing);
      existing.serializeAttachment({ ...a, closed: true });
      existing.close(4001, "Reconnected in another tab");
    }
    const pair = new WebSocketPair();
    const speaker = this.participant(id);
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ speaker, windowStart: Date.now(), count: 0 } satisfies Attachment);
    this.ctx.storage.sql.exec("DELETE FROM messages WHERE updated < ?", Date.now() - RETENTION_MS);
    const messages = this.ctx.storage.sql.exec<Row>("SELECT * FROM messages ORDER BY ordinal DESC LIMIT ?", MAX_HISTORY).toArray().reverse().map(row => this.message(row));
    this.send(pair[1], { type: "welcome", self: speaker, participants: this.presence(), messages });
    this.broadcast({ type: "presence", participants: this.presence() });
    await this.scheduleCleanup();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const a = this.attachment(ws);
    if (a.closed) return;
    if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 20_000) {
      ws.close(1009, "Only small text messages are accepted"); this.disconnect(ws); return;
    }
    const now = Date.now();
    if (now - a.windowStart >= 10_000) { a.windowStart = now; a.count = 0; }
    if (++a.count > 160) { ws.close(1008, "Too many updates"); this.disconnect(ws); return; }
    ws.serializeAttachment(a);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { this.send(ws, { type: "error", message: "Invalid message." }); return; }
    const update = parseTranscript(payload);
    if (!update) { this.send(ws, { type: "error", message: "Invalid transcript." }); return; }
    const id = `${a.speaker.id}/${update.utteranceId}`;
    const old = this.ctx.storage.sql.exec<Row>("SELECT * FROM messages WHERE id = ?", id).toArray()[0];
    if (old && (old.status === "final" || update.revision <= old.revision)) {
      this.send(ws, { type: "ack", utteranceId: update.utteranceId, revision: old.status === "final" ? update.revision : old.revision });
      this.send(ws, { type: "message", message: this.message(old) });
      return;
    }
    if (!update.text && !old) {
      this.send(ws, { type: "ack", utteranceId: update.utteranceId, revision: update.revision }); return;
    }
    if (!old && !update.final) {
      const { count } = this.ctx.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM messages WHERE speaker = ? AND status = 'live'", a.speaker.id).one();
      if (count >= 4) { ws.close(1008, "Too many unfinished phrases"); this.disconnect(ws); return; }
    }
    // A single SQLite upsert preserves the first-seen order through every revision.
    this.ctx.storage.sql.exec(`INSERT INTO messages (id, speaker, utterance, revision, text, status, started, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, text=excluded.text, status=excluded.status, updated=excluded.updated`,
      id, a.speaker.id, update.utteranceId, update.revision, update.text, update.final ? "final" : "live", now, now);
    this.ctx.storage.sql.exec(`DELETE FROM messages WHERE ordinal NOT IN
      (SELECT ordinal FROM messages ORDER BY ordinal DESC LIMIT ?) AND status != 'live'`, MAX_HISTORY);
    const row = this.ctx.storage.sql.exec<Row>("SELECT * FROM messages WHERE id = ?", id).one();
    this.broadcast({ type: "message", message: this.message(row) });
    this.send(ws, { type: "ack", utteranceId: update.utteranceId, revision: update.revision });
    await this.scheduleCleanup();
  }

  private disconnect(ws: WebSocket): void {
    const a = this.attachment(ws);
    if (a.closed) return;
    ws.serializeAttachment({ ...a, closed: true });
    const rows = this.ctx.storage.sql.exec<Row>(
      "UPDATE messages SET status = 'interrupted' WHERE speaker = ? AND status = 'live' RETURNING *", a.speaker.id).toArray();
    for (const row of rows) this.broadcast({ type: "message", message: this.message(row) });
    this.broadcast({ type: "presence", participants: this.presence() });
  }

  webSocketClose(ws: WebSocket): void { this.disconnect(ws); }
  webSocketError(ws: WebSocket): void { this.disconnect(ws); }

  private async scheduleCleanup(): Promise<void> {
    // Do not postpone an existing alarm with each incoming word.
    const next = Date.now() + STALE_MS;
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > next) await this.ctx.storage.setAlarm(next);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const stale = this.ctx.storage.sql.exec<Row>(
      "UPDATE messages SET status = 'interrupted' WHERE status = 'live' AND updated <= ? RETURNING *", now - STALE_MS).toArray();
    for (const row of stale) this.broadcast({ type: "message", message: this.message(row) });
    this.ctx.storage.sql.exec("DELETE FROM messages WHERE updated <= ?", now - RETENTION_MS);
    const next = this.ctx.storage.sql.exec<{ next: number | null }>(
      "SELECT MIN(updated + CASE WHEN status = 'live' THEN ? ELSE ? END) AS next FROM messages", STALE_MS, RETENTION_MS).one().next;
    if (next !== null) await this.ctx.storage.setAlarm(Math.max(now + 1000, next));
    else if (this.sockets().length === 0) this.ctx.storage.sql.exec("DELETE FROM members");
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    // Room URLs are unguessable bearer invitations; only same-origin browser requests may use them.
    if (request.headers.get("Origin") !== url.origin) return new Response("Origin not allowed", { status: 403 });
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      return Response.json({ id: crypto.randomUUID() }, { headers: { "Cache-Control": "no-store" } });
    }
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/socket$/);
    const token = url.searchParams.get("session");
    if (!match || !UUID.test(match[1]) || !token || !UUID.test(token)) return new Response("Invalid room", { status: 400 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket required", { status: 426 });
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const speakerId = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
    const forwarded = new Request(request);
    forwarded.headers.set("x-speaker-id", speakerId);
    return env.ROOMS.getByName(match[1]).fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;
