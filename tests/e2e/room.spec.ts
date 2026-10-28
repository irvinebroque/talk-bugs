import { test, expect, type Page } from "@playwright/test";
import WebSocket from "ws";
import type { ServerEvent } from "../../../shared/protocol";

// Mock only the browser speech engine; all UI, network, and Durable Objects are real.
async function speechEngine(page: Page, available = "available", kind = "local", delayedStart = false) {
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

async function hold(page: Page) {
  const button = page.getByTestId("push-to-talk");
  await expect(button).toBeEnabled();
  await button.hover();
  await page.mouse.down();
}

async function readerFor(page: Page) {
  const reader = await page.context().newPage();
  await reader.goto(page.url());
  await expect(reader.getByText("Connected", { exact: true })).toBeVisible();
  return reader;
}

async function say(page: Page, text: string, final = false) {
  await page.evaluate(({ text, final }) => {
    (window as any).__speech.onresult({ resultIndex: 0, results: [{ isFinal: final, 0: { transcript: text } }] });
  }, { text, final });
}

test("three people read only others, keep stable places, and recover full history", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  const path = `/r/${crypto.randomUUID()}`;
  for (const page of pages) { await speechEngine(page); await page.goto(path); }
  for (const page of pages) await hold(page);
  await Promise.all([say(pages[0], "A green"), say(pages[1], "At the same time"), say(pages[2], "A third voice")]);
  for (const page of pages) await expect(page.getByTestId("message")).toHaveCount(2);
  const positions = await pages[2].getByTestId("speaker").evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute("data-speaker"), y: n.getBoundingClientRect().y })));
  await expect(pages[0].getByTestId("incoming")).not.toContainText("A green");
  await say(pages[0], "Agreed, let’s meet tomorrow.", true);
  await pages[0].mouse.up();
  for (const page of pages.slice(1)) {
    await expect(page.getByTestId("message").filter({ hasText: "Agreed, let’s meet tomorrow." })).toHaveAttribute("data-status", "final");
    await expect(page.locator("input, textarea, [contenteditable=true], audio, video")).toHaveCount(0);
  }
  expect(await pages[2].getByTestId("speaker").evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute("data-speaker"), y: n.getBoundingClientRect().y })))).toEqual(positions);
  await pages[1].mouse.up(); await pages[2].mouse.up();
  await pages[0].reload();
  await expect(pages[0].getByTestId("message")).toHaveCount(2);
  await expect(pages[0].getByTestId("incoming")).not.toContainText("Agreed");
  await pages[0].getByRole("button", { name: "History", exact: true }).click();
  await expect(pages[0].getByTestId("history-message")).toHaveCount(3);
  await expect(pages[0].getByTestId("history-message").filter({ hasText: "Agreed" })).toContainText("You");
  await Promise.all(contexts.map(c => c.close()));
});

test("local recognition handles permission errors without a typed fallback", async ({ page }) => {
  await speechEngine(page);
  await page.goto(`/r/${crypto.randomUUID()}`);
  await hold(page);
  await page.evaluate(() => {
    (window as any).__speech.onerror({ error: "not-allowed" });
    (window as any).__speech.onend();
  });
  await expect(page.getByRole("alert")).toContainText("Microphone access was denied");
  await expect(page.locator("input, textarea, [contenteditable=true]")).toHaveCount(0);
});

test("connection loss pauses the microphone and replays the latest unacknowledged phrase once", async ({ browser }) => {
  const writerContext = await browser.newContext();
  const readerContext = await browser.newContext();
  const writer = await writerContext.newPage(), reader = await readerContext.newPage();
  const path = `/r/${crypto.randomUUID()}`;
  await writer.addInitScript(() => {
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).includes("/socket?")) (window as any).__roomSocket = this;
      }
    };
  });
  await speechEngine(writer);
  await writer.goto(path); await reader.goto(path);
  await hold(writer);
  await say(writer, "Before the interruption");
  await expect(reader.getByTestId("message")).toHaveCount(1);
  await writer.evaluate(() => {
    (window as any).__roomSocket.close(4000, "Test network interruption");
    (window as any).__speech.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "The complete thought survives." } }] });
  });
  await expect(reader.getByTestId("message").filter({ hasText: "The complete thought survives." })).toHaveAttribute("data-status", "final");
  await expect(reader.getByTestId("message")).toHaveCount(1);
  await expect(writer.getByRole("button", { name: "Hold to talk", exact: true })).toBeEnabled();
  await expect(writer.getByText(/turn.*syncing/)).toHaveCount(0);
  await writerContext.close(); await readerContext.close();
});

test("browsers without speech recognition can still read and invite", async ({ page }) => {
  await page.addInitScript(() => { (window as any).SpeechRecognition = undefined; (window as any).webkitSpeechRecognition = undefined; });
  await page.goto(`/r/${crypto.randomUUID()}`);
  await expect(page.getByRole("button", { name: "Speech unavailable", exact: true })).toBeDisabled();
  await expect(page.getByText("This browser doesn’t support speech recognition.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite", exact: true })).toBeEnabled();
});

test("opening the app enters a room immediately and mobile layout fits", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/r\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "talk-bugs", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const roomUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(roomUrl);
  await page.getByRole("link", { name: "New room", exact: true }).click();
  await expect(page).not.toHaveURL(roomUrl);
  await expect(page).toHaveURL(/\/r\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "No one else here" })).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-room.png", fullPage: true });
});

function connect(room: string, session = crypto.randomUUID(), origin = "http://127.0.0.1:5173") {
  const ws = new WebSocket(`ws://127.0.0.1:5173/api/rooms/${room}/socket?session=${session}`, { origin });
  const events: ServerEvent[] = [];
  ws.on("message", data => { if (data.toString() !== "pong") events.push(JSON.parse(data.toString())); });
  return { ws, events, session };
}

test("retries are idempotent, revisions cannot regress, speaker identity is server-owned, and rooms are isolated", async () => {
  const roomId = crypto.randomUUID();
  const a = connect(roomId), b = connect(roomId), other = connect(crypto.randomUUID());
  try {
    await expect.poll(() => a.events.some(e => e.type === "welcome")).toBe(true);
    await expect.poll(() => b.events.some(e => e.type === "welcome")).toBe(true);
    await expect.poll(() => other.events.some(e => e.type === "welcome")).toBe(true);
    const utteranceId = crypto.randomUUID();
    const send = (revision: number, text: string, final = false) => a.ws.send(JSON.stringify({ type: "transcript", utteranceId, revision, text, final, speaker: "spoofed" }));
    send(2, "second revision"); send(1, "stale"); send(2, "duplicate"); send(3, "final words", true); send(4, "cannot rewrite final");
    await expect.poll(() => b.events.filter(e => e.type === "message").length).toBe(2);
    const incoming = b.events.filter(e => e.type === "message");
    expect(incoming[0].message.speaker.id).not.toBe("spoofed");
    expect(incoming[1].message.text).toBe("final words");
    expect(incoming[0].message.order).toBe(incoming[1].message.order);
    expect(other.events.filter(e => e.type === "message")).toHaveLength(0);
    a.ws.close();
    const resumed = connect(roomId, a.session);
    try {
      await expect.poll(() => resumed.events.some(e => e.type === "welcome")).toBe(true);
      const welcome = resumed.events.find(e => e.type === "welcome")!;
      expect(welcome.messages).toHaveLength(1);
      expect(welcome.messages[0].text).toBe("final words");
      expect(welcome.self.id).toBe(incoming[0].message.speaker.id);
    } finally { resumed.ws.close(); }
  } finally { a.ws.close(); b.ws.close(); other.ws.close(); }
});

test("binary audio is rejected and disconnected drafts stop looking live", async () => {
  const roomId = crypto.randomUUID();
  const a = connect(roomId), b = connect(roomId);
  try {
    await expect.poll(() => a.events.some(e => e.type === "welcome")).toBe(true);
    await expect.poll(() => b.events.some(e => e.type === "welcome")).toBe(true);
    a.ws.send(JSON.stringify({ type: "transcript", utteranceId: crypto.randomUUID(), revision: 1, text: "unfinished", final: false }));
    await expect.poll(() => b.events.some(e => e.type === "message" && e.message.status === "live")).toBe(true);
    const closed = new Promise<number>(resolve => a.ws.on("close", code => resolve(code)));
    a.ws.send(Buffer.from([1, 2, 3]));
    expect(await closed).toBe(1009);
    await expect.poll(() => b.events.some(e => e.type === "message" && e.message.status === "interrupted")).toBe(true);
  } finally { a.ws.close(); b.ws.close(); }
});

test("API rejects cross-origin access", async ({ request }) => {
  const response = await request.post("/api/rooms", { headers: { Origin: "https://unrelated.example" } });
  expect(response.status()).toBe(403);
});

for (const [kind, available] of [
  ["standard", "available"],
  ["prefixed", "available"],
  ["local", "unavailable"],
  ["local", "downloadable"],
  ["local", "downloading"],
  ["local", "error"],
]) {
  test(`standard recognition streams revisions: ${kind}, local pack ${available}`, async ({ page }) => {
    await speechEngine(page, available, kind);
    await page.goto(`/r/${crypto.randomUUID()}`);
    const reader = await readerFor(page);
    await hold(page);
    await say(page, "A partial thought");
    await expect(reader.getByTestId("message")).toHaveAttribute("data-status", "live");
    await say(page, "A completed thought", true);
    await expect(reader.getByTestId("message")).toHaveCount(1);
    await expect(reader.getByTestId("message")).toHaveAttribute("data-status", "live");
    await expect(reader.getByTestId("message")).toContainText("A completed thought");
    await page.mouse.up();
    await expect(reader.getByTestId("message")).toHaveAttribute("data-status", "final");
    await expect(page.getByRole("button", { name: "Hold to talk", exact: true })).toBeEnabled();
    await expect(page.getByText(/On-device|Download speech pack|browser vendor/)).toHaveCount(0);
    await expect(page.locator("input, textarea, [contenteditable=true], audio, video")).toHaveCount(0);
  });
}

test("releasing outside the hold button finalizes words and stops the microphone", async ({ page }) => {
  await speechEngine(page); await page.goto(`/r/${crypto.randomUUID()}`);
  const reader = await readerFor(page);
  await hold(page);
  await expect(page.getByTestId("push-to-talk")).toHaveText("Release to finish");
  await say(page, "This turn ends on release");
  await expect(reader.getByTestId("message")).toHaveAttribute("data-status", "live");
  await page.mouse.move(2, 2); await page.mouse.up();
  await expect(reader.getByTestId("message")).toHaveAttribute("data-status", "final");
  await expect(page.getByTestId("push-to-talk")).toHaveText("Hold to talk");
  expect(await page.evaluate(() => (window as any).__speechStops)).toBe(1);
});

test("Space and Enter hold to talk without key repeat or click toggling", async ({ page }) => {
  await speechEngine(page); await page.goto(`/r/${crypto.randomUUID()}`);
  const reader = await readerFor(page);
  const button = page.getByTestId("push-to-talk");
  await expect(button).toBeEnabled(); await button.focus();
  await page.keyboard.down("Space"); await page.keyboard.down("Space");
  await say(page, "Keyboard hold"); await page.keyboard.up("Space");
  await expect(button).toHaveText("Hold to talk");
  expect(await page.evaluate(() => (window as any).__speechStarts)).toBe(1);
  await page.keyboard.down("Enter"); await say(page, "Another turn"); await page.keyboard.up("Enter");
  await expect(reader.getByTestId("message")).toHaveCount(1);
  await expect(reader.getByTestId("previous-message")).toHaveCount(1);
  await expect(button).toHaveText("Hold to talk");
  await button.click();
  await expect(button).toHaveText("Hold to talk");
  expect(await page.evaluate(() => (window as any).__speechStarts)).toBe(3);
  expect(await page.evaluate(() => (window as any).__speechStops)).toBe(3);
});

test("releasing during permission/startup prevents a late microphone start", async ({ page }) => {
  await speechEngine(page, "available", "local", true); await page.goto(`/r/${crypto.randomUUID()}`);
  const reader = await readerFor(page);
  await hold(page); await page.mouse.up();
  await expect(page.getByTestId("push-to-talk")).toHaveText("Hold to talk");
  await page.evaluate(() => (window as any).__speech.onstart());
  await say(page, "Must never be sent after release");
  await expect(page.getByTestId("push-to-talk")).toHaveText("Hold to talk");
  await expect(reader.getByTestId("message")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => { (window as any).__oldSpeech = (window as any).__speech; });
  await hold(page);
  await page.evaluate(() => {
    (window as any).__oldSpeech.onstart(); // A stale abort must not cancel the next hold.
    (window as any).__speech.onstart();
  });
  await expect(page.getByTestId("push-to-talk")).toHaveText("Release to finish");
  await say(page, "The next hold still works"); await page.mouse.up();
  await expect(reader.getByTestId("message")).toHaveAttribute("data-status", "final");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("losing focus ends a hold and a stopped recognizer cannot restart", async ({ page }) => {
  await speechEngine(page); await page.goto(`/r/${crypto.randomUUID()}`);
  const reader = await readerFor(page);
  await hold(page); await say(page, "Before switching apps");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(reader.getByTestId("message")).toHaveAttribute("data-status", "final");
  await expect(page.getByTestId("push-to-talk")).toHaveText("Hold to talk");
  await page.mouse.up();
  await hold(page);
  await page.evaluate(() => (window as any).__speech.onend());
  await expect.poll(() => page.evaluate(() => (window as any).__speechStarts)).toBe(3);
  await page.evaluate(() => (window as any).__speech.onend());
  await page.mouse.up();
  await page.waitForTimeout(500); // Longer than the recognizer's restart timer.
  expect(await page.evaluate(() => (window as any).__speechStarts)).toBe(3);
});

test("touch holds end on both finger release and pointer cancellation", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await speechEngine(page); await page.goto(`/r/${crypto.randomUUID()}`);
  const reader = await readerFor(page);
  const button = page.getByTestId("push-to-talk"); await expect(button).toBeEnabled();
  const box = (await button.boundingBox())!;
  const session = await context.newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (const [end, text] of [["touchEnd", "Released a touch"], ["touchCancel", "Cancelled a touch"]] as const) {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await expect(button).toHaveText("Release to finish");
    await say(page, text);
    await session.send("Input.dispatchTouchEvent", { type: end, touchPoints: [] });
    await expect(button).toHaveText("Hold to talk");
    await expect(reader.getByTestId("message").filter({ hasText: text })).toHaveAttribute("data-status", "final");
  }
  await context.close();
});

test("one hold spans multiple recognition results and restarts, and only keeps two incoming turns", async ({ page }) => {
  await speechEngine(page); await page.goto(`/r/${crypto.randomUUID()}`);
  const reader = await readerFor(page);
  await hold(page);
  await page.evaluate(() => (window as any).__speech.onresult({ resultIndex: 0, results: [
    { isFinal: true, 0: { transcript: "Which aisle are you in?" } },
    { isFinal: false, 0: { transcript: "I'm by the" } },
  ] }));
  await expect(reader.getByTestId("message")).toHaveText("Which aisle are you in? I'm by the");
  const turn = await reader.getByTestId("message").getAttribute("data-turn");
  await page.evaluate(() => (window as any).__speech.onend());
  await expect.poll(() => page.evaluate(() => (window as any).__speechStarts)).toBe(2);
  await say(page, "fruit.", true);
  await expect(reader.getByTestId("message")).toHaveAttribute("data-turn", turn!);
  await expect(reader.getByTestId("message")).toHaveAttribute("data-status", "live");
  await page.mouse.up();
  await expect(reader.getByTestId("message")).toHaveText("Which aisle are you in? I'm by the fruit.");
  await expect(reader.getByTestId("message")).toHaveAttribute("data-status", "final");
  for (const text of ["Oh, I can see it now.", "Let's go."]) {
    await hold(page); await say(page, text); await page.mouse.up();
    await expect(reader.getByTestId("message")).toHaveText(text);
  }
  await expect(reader.getByTestId("previous-message")).toHaveText("Oh, I can see it now.");
  await expect(reader.getByTestId("incoming")).not.toContainText("Which aisle");
  await reader.getByRole("button", { name: "History", exact: true }).click();
  await expect(reader.getByTestId("history-message")).toHaveCount(3);
  await expect(reader.getByTestId("history")).toContainText("Which aisle are you in? I'm by the fruit.");
});

test("long concurrent corrections never scroll the reader or move another speaker", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const room = crypto.randomUUID();
  const a = connect(room);
  await expect.poll(() => a.events.some(e => e.type === "welcome")).toBe(true);
  const b = connect(room);
  try {
    await expect.poll(() => a.events.some(e => e.type === "welcome")).toBe(true);
    await expect.poll(() => b.events.some(e => e.type === "welcome")).toBe(true);
    await page.goto(`/r/${room}`);
    const id = crypto.randomUUID(), other = crypto.randomUUID();
    a.ws.send(JSON.stringify({ type: "transcript", utteranceId: id, revision: 1, text: "A readable sentence. ".repeat(70), final: false }));
    b.ws.send(JSON.stringify({ type: "transcript", utteranceId: other, revision: 1, text: "Read me while they speak.", final: false }));
    await expect(page.getByTestId("message")).toHaveCount(2);
    const aID = a.events.find(e => e.type === "welcome")!.self.id;
    const bID = b.events.find(e => e.type === "welcome")!.self.id;
    const speaker = page.locator(`[data-testid="speaker"][data-speaker="${aID}"]`);
    const second = page.locator(`[data-testid="speaker"][data-speaker="${bID}"]`);
    await expect(second.getByTestId("message")).toBeInViewport({ ratio: 1 });
    const before = await second.boundingBox();
    const words = speaker.getByTestId("speaker-words");
    await words.evaluate(element => { element.scrollTop = 70; });
    for (let revision = 2; revision <= 8; revision++) {
      a.ws.send(JSON.stringify({ type: "transcript", utteranceId: id, revision, text: "A corrected readable sentence. ".repeat(70), final: revision === 8 }));
    }
    await expect(speaker.getByTestId("message")).toHaveAttribute("data-status", "final");
    expect(await words.evaluate(element => element.scrollTop)).toBe(70);
    expect((await second.boundingBox())!.y).toBe(before!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    a.ws.close();
    await expect(speaker).toContainText("Left room");
    await expect(page.getByTestId("speaker")).toHaveCount(2);
    expect((await second.boundingBox())!.y).toBe(before!.y);
    await expect(speaker.getByTestId("message")).toContainText("A corrected readable sentence.");
    await page.screenshot({ path: "test-results/incoming-group-mobile.png", fullPage: true });
  } finally { a.ws.close(); b.ws.close(); }
});
