import { MAX_TEXT, parseSealed, UUID, type Message, type Transcript } from "../../shared/protocol";

export function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error("Invalid encoding");
  return bytes;
}
export function validKey(value: string): boolean {
  try { return value.length === 43 && decode(value).length === 32; } catch { return false; }
}
export function newRoomPath(): string {
  return `/e/${crypto.randomUUID()}#key=${encode(crypto.getRandomValues(new Uint8Array(32)))}`;
}
export function importRoomKey(value: string): Promise<CryptoKey> {
  if (!validKey(value)) throw new Error("Open the full invite link, including its secret key.");
  return crypto.subtle.importKey("raw", decode(value), "AES-GCM", false, ["encrypt", "decrypt"]);
}
function context(room: string, speaker: string, id: string, revision: number, final: boolean): Uint8Array<ArrayBuffer> {
  if (!UUID.test(room) || !/^[a-f0-9]{64}$/.test(speaker) || !UUID.test(id) || !Number.isSafeInteger(revision) || revision < 1) throw new Error("Invalid message");
  return new TextEncoder().encode(`talk-bugs:e2ee:v1\n${room.toLowerCase()}\n${speaker}\n${id.toLowerCase()}\n${revision}\n${final ? 1 : 0}`);
}
export async function sealTranscript(key: CryptoKey, room: string, speaker: string, update: Transcript): Promise<Transcript> {
  if (update.text.length > MAX_TEXT) throw new Error("Message is too long");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128,
    additionalData: context(room, speaker, update.utteranceId, update.revision, update.final) }, key, new TextEncoder().encode(update.text));
  return { type: "transcript", utteranceId: update.utteranceId.toLowerCase(), revision: update.revision, final: update.final,
    text: "", sealed: { v: 1, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) } };
}
export async function openMessage(key: CryptoKey, room: string, message: Message): Promise<Message> {
  const sealed = parseSealed(message.sealed);
  if (!sealed || message.text !== "" || message.id !== `${message.speaker.id}/${message.utteranceId}` ||
    !["live", "final", "interrupted"].includes(message.status)) throw new Error("Invalid encrypted message");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(sealed.iv), tagLength: 128,
    additionalData: context(room, message.speaker.id, message.utteranceId, message.revision, message.status === "final") }, key, decode(sealed.ciphertext));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  if (text.length > MAX_TEXT) throw new Error("Message is too long");
  return { ...message, text };
}
