import { MAX_TEXT, type Transcript } from "../../shared/protocol";
import type { SpeechResult } from "./speech";

// One hold owns one ID, including any recognizer restarts while the button is held.
export class SpeechTurn {
  private prefix = "";
  private session = "";
  private last: Transcript;
  private ended = false;
  constructor(id = crypto.randomUUID()) {
    this.last = { type: "transcript", utteranceId: id, revision: 0, text: "", final: false };
  }
  update(results: ArrayLike<SpeechResult>): Transcript | null {
    this.session = Array.from(results, result => result[0].transcript.trim()).filter(Boolean).join(" ");
    return this.revise(false);
  }
  restart() {
    this.prefix = this.text;
    this.session = "";
  }
  get text() { return [this.prefix, this.session].filter(Boolean).join(" ").slice(0, MAX_TEXT); }
  finish(): Transcript | null { return this.revise(true); }
  private revise(final: boolean): Transcript | null {
    if (this.ended || (!final && this.text === this.last.text)) return null;
    this.ended = final;
    if (!this.text && this.last.revision === 0) return null;
    this.last = { ...this.last, text: this.text, revision: this.last.revision + 1, final };
    return this.last;
  }
}
