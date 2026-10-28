export const MAX_TEXT = 4000;
export const MAX_HISTORY = 200;
export const MAX_MEMBERS = 24;
export const RETENTION_MS = 24 * 60 * 60 * 1000;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Participant = { id: string; name: string; color: number };
export type Sealed = { v: 1; iv: string; ciphertext: string };
export type Transcript = {
  type: "transcript";
  utteranceId: string;
  revision: number;
  text: string;
  final: boolean;
  sealed?: Sealed;
};
export type Message = {
  id: string;
  utteranceId: string;
  speaker: Participant;
  revision: number;
  text: string;
  status: "live" | "final" | "interrupted";
  order: number;
  startedAt: number;
  updatedAt: number;
  sealed?: Sealed;
};
export type ServerEvent =
  | { type: "welcome"; self: Participant; participants: Participant[]; messages: Message[] }
  | { type: "presence"; participants: Participant[] }
  | { type: "message"; message: Message }
  | { type: "ack"; utteranceId: string; revision: number }
  | { type: "error"; message: string };

export function parseSealed(raw: unknown): Sealed | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (p.v !== 1 || typeof p.iv !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(p.iv) ||
    typeof p.ciphertext !== "string" || !/^[A-Za-z0-9_-]+$/.test(p.ciphertext) ||
    p.ciphertext.length < 22 || p.ciphertext.length > Math.ceil((MAX_TEXT * 3 + 16) * 4 / 3) || p.ciphertext.length % 4 === 1) return null;
  return { v: 1, iv: p.iv, ciphertext: p.ciphertext };
}

export function parseTranscript(raw: unknown, encrypted = false): Transcript | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (p.type !== "transcript" || typeof p.utteranceId !== "string" || !UUID.test(p.utteranceId) ||
    typeof p.revision !== "number" || !Number.isSafeInteger(p.revision) || p.revision < 1 ||
    typeof p.text !== "string" || p.text.length > MAX_TEXT || typeof p.final !== "boolean") return null;
  if (encrypted) {
    const sealed = parseSealed(p.sealed);
    if (!sealed || p.text !== "") return null;
    return { type: "transcript", utteranceId: p.utteranceId.toLowerCase(), revision: p.revision, text: "", final: p.final, sealed };
  }
  if (p.sealed !== undefined) return null;
  return { type: "transcript", utteranceId: p.utteranceId, revision: p.revision,
    text: p.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim(), final: p.final };
}

export function mergeMessage(messages: Message[], incoming: Message): Message[] {
  const old = messages.find(m => m.id === incoming.id);
  if (old && (old.revision > incoming.revision || old.status === "final")) return messages;
  return [...messages.filter(m => m.id !== incoming.id), incoming]
    .sort((a, b) => a.order - b.order).slice(-MAX_HISTORY);
}
