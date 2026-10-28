import { describe, expect, it } from "vitest";
import { SpeechTurn } from "../src/lib/speech-turn";
import { MAX_TEXT } from "../shared/protocol";
const results = (...parts: string[]) => parts.map(text => ({ isFinal: true, 0: { transcript: text } }));

describe("one hold, one turn", () => {
  it("combines finalized recognition segments and interim revisions until release", () => {
    const turn = new SpeechTurn();
    const first = turn.update(results("Which aisle"))!;
    const revised = turn.update(results("Which aisle are you in?", "I'm by the fruit."))!;
    expect(revised.utteranceId).toBe(first.utteranceId);
    expect(revised.text).toBe("Which aisle are you in? I'm by the fruit.");
    expect(revised.final).toBe(false);
    expect(turn.finish()).toMatchObject({ utteranceId: first.utteranceId, text: revised.text, final: true, revision: 3 });
    expect(turn.finish()).toBeNull();
    expect(turn.update(results("late result"))).toBeNull();
  });
  it("preserves words across recognizer restarts and retracts corrected interim words", () => {
    const turn = new SpeechTurn();
    turn.update(results("First sentence.")); turn.restart();
    turn.update(results("Second sentence.", "mistake"));
    expect(turn.update(results("Second sentence."))?.text).toBe("First sentence. Second sentence.");
    expect(turn.finish()?.text).toBe("First sentence. Second sentence.");
  });
  it("discards empty holds, suppresses duplicate revisions, and bounds text", () => {
    expect(new SpeechTurn().finish()).toBeNull();
    const turn = new SpeechTurn();
    turn.update(results("hello")); expect(turn.update(results("hello"))).toBeNull();
    expect(turn.update(results())?.text).toBe("");
    expect(turn.update(results("x".repeat(MAX_TEXT + 10)))?.text.length).toBe(MAX_TEXT);
    expect(turn.finish()?.final).toBe(true);
  });
});
