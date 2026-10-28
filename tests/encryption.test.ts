import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { importRoomKey, openMessage, sealTranscript, validKey } from "../src/lib/encryption";
import { parseTranscript, type Message } from "../shared/protocol";
const fixture = JSON.parse(readFileSync(new URL("../native/Core/Tests/TalkBugsCoreTests/Fixtures/e2ee-v1.json", import.meta.url), "utf8"));
const key = () => importRoomKey(fixture.key);

describe("encrypted transcript boundary", () => {
  it("opens the shared Web Crypto / CryptoKit vector", async () => {
    expect((await openMessage(await key(), fixture.room, fixture.message)).text).toBe(fixture.text);
  });
  it("uses a fresh nonce for every encryption and round-trips Unicode", async () => {
    const update = { type: "transcript" as const, utteranceId: fixture.message.utteranceId, revision: 2, text: fixture.text, final: false };
    const one = await sealTranscript(await key(), fixture.room, fixture.message.speaker.id, update);
    const two = await sealTranscript(await key(), fixture.room, fixture.message.speaker.id, update);
    expect(one.sealed!.iv).not.toBe(two.sealed!.iv);
    expect(one.text).toBe("");
    expect(JSON.stringify(one)).not.toContain(fixture.text);
    const message = { ...fixture.message, ...one, status: "live" } as Message;
    expect((await openMessage(await key(), fixture.room, message)).text).toBe(fixture.text);
    expect((await openMessage(await key(), fixture.room, { ...message, status: "interrupted" })).text).toBe(fixture.text);
  });
  it("rejects tampering, wrong keys, and replay into another room or message", async () => {
    const message = fixture.message as Message;
    for (const changed of [
      { ...message, revision: 2 }, { ...message, status: "live" as const }, { ...message, text: "Injected plaintext" },
      { ...message, utteranceId: crypto.randomUUID() }, { ...message, speaker: { ...message.speaker, id: "a".repeat(64) } },
      { ...message, sealed: { ...message.sealed!, iv: "AAAAAAAAAAAAAAAA" } },
      { ...message, sealed: { ...message.sealed!, ciphertext: "A" + message.sealed!.ciphertext.slice(1) } },
      { ...message, sealed: undefined },
    ]) await expect(openMessage(await key(), fixture.room, changed)).rejects.toThrow();
    await expect(openMessage(await key(), crypto.randomUUID(), message)).rejects.toThrow();
    await expect(openMessage(await importRoomKey("A".repeat(43)), fixture.room, message)).rejects.toThrow();
  });
  it("never accepts plaintext in encrypted rooms or ciphertext in legacy rooms", () => {
    const plain = { type: "transcript", utteranceId: fixture.message.utteranceId, revision: 1, text: "hi", final: true };
    const encrypted = { ...plain, text: "", sealed: fixture.message.sealed };
    expect(parseTranscript(plain, true)).toBeNull();
    expect(parseTranscript(encrypted, true)).toEqual(encrypted);
    expect(parseTranscript(encrypted)).toBeNull();
    for (const sealed of [null, { ...encrypted.sealed, v: 2 }, { ...encrypted.sealed, iv: "bad" }, { ...encrypted.sealed, ciphertext: "x".repeat(20000) }]) {
      expect(parseTranscript({ ...encrypted, sealed }, true)).toBeNull();
    }
    expect(parseTranscript({ ...encrypted, text: "leak" }, true)).toBeNull();
  });
  it("rejects missing, short, padded, and noncanonical keys", () => {
    for (const bad of ["", "short", fixture.key + "=", "-".repeat(43)]) expect(validKey(bad)).toBe(false);
    expect(validKey(fixture.key)).toBe(true);
  });
});
