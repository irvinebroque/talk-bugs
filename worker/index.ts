import { DurableObject } from "cloudflare:workers";
import { MAX_HISTORY, MAX_MEMBERS, RETENTION_MS, UUID, parseTranscript,
  type Message, type Participant, type ServerEvent, type Transcript } from "../shared/protocol";

type Attachment = { speaker: Participant; windowStart: number; count: number; closed?: boolean; encrypted?: boolean };
type Row = { id: string; speaker: string; utterance: string; revision: number; text: string; sealed: string | null;
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
      CREATE TABLE IF NOT EXISTS http_members (id TEXT PRIMARY KEY, seen INTEGER NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS room_version (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO room_version VALUES (1, 0);
    `);
    if (!ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(messages)").toArray().some(column => column.name === "sealed")) {
      ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN sealed TEXT");
    }
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
      revision: row.revision, text: row.text, ...(row.sealed ? { sealed: JSON.parse(row.sealed) } : {}), status: row.status,
      order: row.ordinal, startedAt: row.started, updatedAt: row.updated };
  }

  private send(ws: WebSocket, event: ServerEvent): void {
    try { ws.send(JSON.stringify(event)); } catch { this.disconnect(ws); }
  }

  private broadcast(event: ServerEvent): void {
    this.ctx.storage.sql.exec("UPDATE room_version SET revision = revision + 1 WHERE id = 1");
    for (const ws of this.sockets()) this.send(ws, event);
  }

  private presence(): Participant[] {
    const ids = new Set(this.sockets().map(ws => this.attachment(ws).speaker.id));
    for (const row of this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM http_members WHERE seen > ?", Date.now() - STALE_MS)) ids.add(row.id);
    return [...ids].map(id => this.participant(id));
  }

  private expireHTTP(): void {
    const expired = this.ctx.storage.sql.exec("DELETE FROM http_members WHERE seen <= ? RETURNING id", Date.now() - STALE_MS).toArray();
    if (expired.length) this.broadcast({ type: "presence", participants: this.presence() });
  }

  private async http(request: Request, id: string): Promise<Response> {
    this.expireHTTP();
    const path = new URL(request.url).pathname;
    const headers = { "Cache-Control": "no-store" };
    if (path.endsWith("/leave") && request.method === "POST") {
      this.ctx.storage.sql.exec("DELETE FROM http_members WHERE id = ?", id);
      this.broadcast({ type: "presence", participants: this.presence() });
      return new Response(null, { status: 204, headers });
    }
    if (!(path.endsWith("/snapshot") && request.method === "GET") && !(path.endsWith("/transcript") && request.method === "POST"))
      return new Response("Method not allowed", { status: 405, headers });
    const present = this.presence();
    if (!present.some(p => p.id === id) && present.length >= MAX_MEMBERS) return new Response("This room is full (24 people).", { status: 503, headers });
    const now = Date.now();
    this.ctx.storage.sql.exec(`INSERT INTO http_members VALUES (?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET seen=excluded.seen`, id, now, now);
    const self = this.participant(id);
    if (!present.some(p => p.id === id)) this.broadcast({ type: "presence", participants: this.presence() });
    await this.scheduleCleanup();
    if (request.method === "GET") {
      const etag = `"${this.ctx.storage.sql.exec<{ revision: number }>("SELECT revision FROM room_version").one().revision}"`;
      if (request.headers.get("If-None-Match")?.split(",").some(value => value.trim().replace(/^W\//, "") === etag)) return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
      const messages = this.ctx.storage.sql.exec<Row>("SELECT * FROM messages WHERE updated > ? ORDER BY ordinal DESC LIMIT ?", now - RETENTION_MS, MAX_HISTORY).toArray().reverse().map(row => this.message(row));
      return Response.json({ type: "welcome", self, participants: this.presence(), messages }, { headers: { ...headers, ETag: etag } });
    }
    if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return new Response("Only text transcripts are accepted", { status: 415, headers });
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 20_000) {
          await reader.cancel();
          return new Response("Transcript too large", { status: 413, headers });
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let update: Transcript | null;
    try { update = parseTranscript(JSON.parse(new TextDecoder().decode(bytes)), request.headers.get("x-encrypted-room") === "1"); } catch { update = null; }
    if (!update) return new Response("Invalid transcript", { status: 400, headers });
    const rate = this.ctx.storage.sql.exec<{ window_start: number; count: number }>("SELECT window_start, count FROM http_members WHERE id = ?", id).toArray()[0];
    if (!rate) return new Response("Session expired; reconnect", { status: 409, headers });
    const count = now - rate.window_start >= 10_000 ? 1 : rate.count + 1;
    if (count > 160) return new Response("Too many updates", { status: 429, headers });
    this.ctx.storage.sql.exec("UPDATE http_members SET count = ?, window_start = ? WHERE id = ?", count, count === 1 ? now : rate.window_start, id);
    try {
      const result = this.acceptTranscript(id, update);
      return Response.json({ type: "ack", utteranceId: update.utteranceId, revision: result.revision }, { headers });
    } catch (error) { return new Response(error instanceof Error ? error.message : "Invalid transcript", { status: 400, headers }); }
  }

  async fetch(request: Request): Promise<Response> {
    const id = request.headers.get("x-speaker-id");
    if (id && !new URL(request.url).pathname.endsWith("/socket")) return this.http(request, id);
    if (!id || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket required", { status: 426 });
    const existing = this.sockets().find(ws => this.attachment(ws).speaker.id === id);
    this.expireHTTP();
    if (!existing && !this.presence().some(p => p.id === id) && this.presence().length >= MAX_MEMBERS) return new Response("This room is full (24 people).", { status: 503 });
    if (existing) {
      const a = this.attachment(existing);
      existing.serializeAttachment({ ...a, closed: true });
      existing.close(4001, "Reconnected in another tab");
    }
    const pair = new WebSocketPair();
    const speaker = this.participant(id);
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ speaker, windowStart: Date.now(), count: 0, encrypted: request.headers.get("x-encrypted-room") === "1" } satisfies Attachment);
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
    const update = parseTranscript(payload, a.encrypted === true);
    if (!update) { this.send(ws, { type: "error", message: "Invalid transcript." }); return; }
    try {
      const result = this.acceptTranscript(a.speaker.id, update);
      this.send(ws, { type: "ack", utteranceId: update.utteranceId, revision: result.revision });
      if (result.message) this.send(ws, { type: "message", message: result.message });
      await this.scheduleCleanup();
    } catch { ws.close(1008, "Too many unfinished phrases"); this.disconnect(ws); }
  }

  private acceptTranscript(speakerId: string, update: Transcript): { revision: number; message?: Message } {
    const now = Date.now();
    const id = `${speakerId}/${update.utteranceId}`;
    const old = this.ctx.storage.sql.exec<Row>("SELECT * FROM messages WHERE id = ?", id).toArray()[0];
    if (old && (old.status === "final" || update.revision <= old.revision)) {
      return { revision: old.status === "final" ? update.revision : old.revision, message: this.message(old) };
    }
    if (!update.text && !update.sealed && !old) {
      return { revision: update.revision };
    }
    if (!old && !update.final) {
      const { count } = this.ctx.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM messages WHERE speaker = ? AND status = 'live'", speakerId).one();
      if (count >= 4) throw new Error("Too many unfinished phrases");
    }
    // A single SQLite upsert preserves the first-seen order through every revision.
    this.ctx.storage.sql.exec(`INSERT INTO messages (id, speaker, utterance, revision, text, status, started, updated, sealed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, text=excluded.text, sealed=excluded.sealed, status=excluded.status, updated=excluded.updated`,
      id, speakerId, update.utteranceId, update.revision, update.text, update.final ? "final" : "live", now, now, update.sealed ? JSON.stringify(update.sealed) : null);
    this.ctx.storage.sql.exec(`DELETE FROM messages WHERE ordinal NOT IN
      (SELECT ordinal FROM messages ORDER BY ordinal DESC LIMIT ?) AND status != 'live'`, MAX_HISTORY);
    const row = this.ctx.storage.sql.exec<Row>("SELECT * FROM messages WHERE id = ?", id).one();
    this.broadcast({ type: "message", message: this.message(row) });
    return { revision: update.revision };
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

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    this.disconnect(ws);
    // Explicitly finish the handshake so browsers can reconnect immediately.
    // Some deployed runtimes leave the client in CLOSING without this reply.
    try { ws.close([1005, 1006, 1015].includes(code) ? 1000 : code, reason); } catch { /* Already closed. */ }
  }
  webSocketError(ws: WebSocket): void { this.disconnect(ws); }

  private async scheduleCleanup(): Promise<void> {
    // Do not postpone an existing alarm with each incoming word.
    const next = Date.now() + STALE_MS;
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > next) await this.ctx.storage.setAlarm(next);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    this.expireHTTP();
    const stale = this.ctx.storage.sql.exec<Row>(
      "UPDATE messages SET status = 'interrupted' WHERE status = 'live' AND updated <= ? RETURNING *", now - STALE_MS).toArray();
    for (const row of stale) this.broadcast({ type: "message", message: this.message(row) });
    const deleted = this.ctx.storage.sql.exec("DELETE FROM messages WHERE updated <= ? RETURNING id", now - RETENTION_MS).toArray();
    if (deleted.length) this.broadcast({ type: "presence", participants: this.presence() });
    const next = this.ctx.storage.sql.exec<{ next: number | null }>(
      "SELECT MIN(updated + CASE WHEN status = 'live' THEN ? ELSE ? END) AS next FROM messages", STALE_MS, RETENTION_MS).one().next;
    const lease = this.ctx.storage.sql.exec<{ next: number | null }>("SELECT MIN(seen + ?) AS next FROM http_members", STALE_MS).one().next;
    const deadline = Math.min(next ?? Infinity, lease ?? Infinity);
    if (Number.isFinite(deadline)) await this.ctx.storage.setAlarm(Math.max(now + 1000, deadline));
    else if (this.sockets().length === 0) this.ctx.storage.sql.exec("DELETE FROM members");
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    // Room URLs are unguessable bearer invitations; only same-origin browser requests may use them.
    const nativeToken = request.headers.get("Authorization")?.match(/^Bearer ([0-9a-f-]+)$/i)?.[1];
    const native = !request.headers.has("Origin") && !!nativeToken && UUID.test(nativeToken);
    if (!native && request.headers.get("Origin") !== url.origin) return new Response("Origin not allowed", { status: 403 });
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      return Response.json({ id: crypto.randomUUID() }, { headers: { "Cache-Control": "no-store" } });
    }
    const match = url.pathname.match(/^\/api\/(rooms|encrypted-rooms)\/([^/]+)\/(socket|snapshot|transcript|leave)$/);
    const token = native ? nativeToken : url.searchParams.get("session");
    if (!match || !UUID.test(match[2]) || !token || !UUID.test(token)) return new Response("Invalid room", { status: 400 });
    if (match[3] === "socket" && request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket required", { status: 426 });
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token.toLowerCase()));
    const speakerId = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
    const forwarded = new Request(request);
    forwarded.headers.set("x-speaker-id", speakerId);
    const encrypted = match[1] === "encrypted-rooms";
    forwarded.headers.set("x-encrypted-room", encrypted ? "1" : "0");
    return env.ROOMS.getByName(`${encrypted ? "e:" : ""}${match[2].toLowerCase()}`).fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;
