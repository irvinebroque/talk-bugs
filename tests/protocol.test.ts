import { describe, expect, it } from "vitest";
import { MAX_TEXT, mergeMessage, parseTranscript, type Message } from "../shared/protocol";

const update = { type: "transcript", utteranceId: crypto.randomUUID(), revision: 1, text: "Hello", final: false };
const message = (id: string, order: number, revision = 1, status: Message["status"] = "live"): Message => ({
  id, order, revision, status, utteranceId: id, text: "hello", speaker: { id, name: "Guest", color: 0 }, startedAt: 1, updatedAt: 1,
});

describe("wire boundary", () => {
  it("validates untrusted transcript sizes, IDs, and revisions", () => {
    expect(parseTranscript(update)).toEqual(update);
    for (const invalid of [null, [], { ...update, revision: -1 }, { ...update, revision: 1.5 },
      { ...update, text: "x".repeat(MAX_TEXT + 1) }, { ...update, utteranceId: "not-an-id" },
      { ...update, final: "true" }, { ...update, type: "audio" }]) expect(parseTranscript(invalid)).toBeNull();
  });
  it("strips control characters and ignores client-supplied speaker identity", () => {
    expect(parseTranscript({ ...update, text: "  hi\u0000 there  ", speaker: "someone else" }))
      .toEqual({ ...update, text: "hi there" });
  });
});

describe("concurrent transcript rendering", () => {
  it("replaces a revision without changing the order of overlapping speakers", () => {
    const result = mergeMessage([message("a", 1), message("b", 2)], { ...message("a", 1, 2), text: "corrected words" });
    expect(result.map(m => m.id)).toEqual(["a", "b"]);
    expect(result[0].text).toBe("corrected words");
    expect(mergeMessage(result, message("a", 1, 1))).toBe(result);
  });
  it("does not reopen finalized phrases", () => {
    const original = [message("a", 1, 2, "final")];
    expect(mergeMessage(original, message("a", 1, 3))).toBe(original);
  });
  it("shows a disconnected stream as interrupted without requiring a new revision", () => {
    expect(mergeMessage([message("a", 1)], message("a", 1, 1, "interrupted"))[0].status).toBe("interrupted");
  });
});
