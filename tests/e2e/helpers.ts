import { expect, type Page } from "@playwright/test";

// Mock only the browser speech engine; all UI, network, and Durable Objects are real.
export async function speechEngine(page: Page, available = "available", kind = "local", delayedStart = false) {
  await page.addInitScript(({ available, kind, delayedStart }) => {
    class Speech {
      processLocally?: boolean;
      constructor() { if (kind === "local") this.processLocally = false; else delete this.processLocally; }
      lang = ""; continuous = false; interimResults = false;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      static async available() { if (available === "error") throw new Error("Local check failed"); return available; }
      start() {
        if (Boolean(this.processLocally) !== (kind === "local" && available === "available")) throw new Error("Wrong recognition mode");
        (window as any).__speech = this;
        (window as any).__speechStarts = ((window as any).__speechStarts ?? 0) + 1;
        if (!delayedStart) this.onstart?.();
      }
      stop() { (window as any).__speechStops = ((window as any).__speechStops ?? 0) + 1; this.onend?.(); }
      abort() { (window as any).__speechAborts = ((window as any).__speechAborts ?? 0) + 1; this.onerror?.({ error: "aborted" }); this.onend?.(); }
    }
    if (kind !== "local") Object.defineProperty(Speech, "available", { value: undefined });
    (window as any).SpeechRecognition = kind === "prefixed" ? undefined : Speech;
    (window as any).webkitSpeechRecognition = kind === "prefixed" ? Speech : undefined;
  }, { available, kind, delayedStart });
}

export async function hold(page: Page) {
  const button = page.getByTestId("push-to-talk");
  await expect(button).toBeEnabled();
  await button.hover();
  await page.mouse.down();
}

export async function readerFor(page: Page) {
  const reader = await page.context().newPage();
  await reader.goto(page.url());
  await expect(reader.getByText("Connected", { exact: true })).toBeVisible();
  return reader;
}

export async function say(page: Page, text: string, final = false) {
  await page.evaluate(({ text, final }) => {
    (window as any).__speech.onresult({ resultIndex: 0, results: [{ isFinal: final, 0: { transcript: text } }] });
  }, { text, final });
}
