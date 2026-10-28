import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { speechEngine, hold, say } from "./helpers";

const run = promisify(execFile);

test("encrypted groups stream, reconnect, preserve history, and keep keys and words off the wire", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  const frames: string[] = [], requests: string[] = [];
  for (const page of pages) {
    page.on("request", request => requests.push(request.url() + (request.postData() ?? "")));
    page.on("websocket", socket => {
      requests.push(socket.url());
      socket.on("framesent", event => frames.push(String(event.payload)));
      socket.on("framereceived", event => frames.push(String(event.payload)));
    });
    await page.addInitScript(() => {
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols); (window as any).__roomSocket = this;
          const events = (window as any).__socketEvents ??= [];
          this.addEventListener("open", () => events.push({ type: "open", at: Date.now() }));
          this.addEventListener("close", event => events.push({ type: "close", code: event.code, reason: event.reason, at: Date.now() }));
          this.addEventListener("error", () => events.push({ type: "error", at: Date.now() }));
        }
      };
    });
    await speechEngine(page);
  }
  await pages[0].goto("/");
  const invitation = pages[0].url(), key = invitation.split("#key=")[1];
  expect(key).toHaveLength(43);
  await pages[1].goto(invitation); await pages[2].goto(invitation);
  for (const page of pages) await hold(page);
  const words = ["Encrypted speaker one 👋", "Encrypted speaker two café", "Encrypted speaker three 你好"];
  await Promise.all(pages.map((page, index) => say(page, words[index])));
  for (const page of pages) await expect(page.getByTestId("message")).toHaveCount(2);
  await pages[0].evaluate(() => {
    (window as any).__roomSocket.close(4000, "Test reconnect");
    (window as any).__speech.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "The encrypted final survives reconnect." } }] });
  });
  try {
    await expect(pages[1].getByTestId("message").filter({ hasText: "The encrypted final survives reconnect." })).toHaveAttribute("data-status", "final");
  } catch (error) {
    await test.info().attach("reconnect-state", { contentType: "application/json", body: JSON.stringify(await pages[0].evaluate(() => ({
      state: (window as any).__roomSocket.readyState, events: (window as any).__socketEvents, screen: document.body.innerText,
    }))) });
    throw error;
  }
  for (const page of pages) await page.mouse.up();
  await pages[0].reload();
  await expect(pages[0].getByTestId("message")).toHaveCount(2);
  await pages[0].getByRole("button", { name: "History", exact: true }).click();
  await expect(pages[0].getByTestId("history-message")).toHaveCount(3);
  await expect(pages[0].getByTestId("history-message").filter({ hasText: "The encrypted final survives reconnect." })).toContainText("You");
  for (const text of [...words, "The encrypted final survives reconnect.", key]) expect([...frames, ...requests].join("\n")).not.toContain(text);
  const sent = frames.filter(frame => frame.startsWith("{")).map(frame => JSON.parse(frame)).filter(frame => frame.type === "transcript");
  expect(sent.length).toBeGreaterThan(3);
  expect(sent.every(update => update.text === "" && update.sealed?.v === 1)).toBe(true);
  await Promise.all(contexts.map(context => context.close()));
});

test("encrypted API rejects plaintext and legacy namespace cannot expose its history", async ({ page, request }) => {
  await speechEngine(page); await page.goto("/");
  const room = new URL(page.url()).pathname.split("/")[2];
  await hold(page); await say(page, "Private words for API isolation"); await page.mouse.up();
  const headers = { Authorization: `Bearer ${crypto.randomUUID()}` };
  const api = `/api/encrypted-rooms/${room}`;
  const plain = { type: "transcript", utteranceId: crypto.randomUUID(), revision: 1, text: "Do not store this plaintext", final: true };
  expect((await request.post(`${api}/transcript`, { headers, data: plain })).status()).toBe(400);
  await expect.poll(async () => (await (await request.get(`${api}/snapshot`, { headers })).json()).messages.length).toBe(1);
  const snapshot = await (await request.get(`${api}/snapshot`, { headers })).json();
  expect(snapshot.messages[0].text).toBe("");
  expect(snapshot.messages[0].sealed.v).toBe(1);
  expect(JSON.stringify(snapshot)).not.toContain("Private words");
  const legacy = await (await request.get(`/api/rooms/${room}/snapshot`, { headers })).json();
  expect(legacy.messages).toHaveLength(0);
  const { sealed } = snapshot.messages[0];
  expect((await request.post(`/api/rooms/${room}/transcript`, { headers, data: { ...plain, text: "", sealed } })).status()).toBe(400);
});

test("missing or wrong keys never show plaintext or silently open a legacy room", async ({ browser }) => {
  const writer = await browser.newPage(); await speechEngine(writer); await writer.goto("/");
  await hold(writer); await say(writer, "Only the intended key can read this"); await writer.mouse.up();
  await writer.getByRole("button", { name: "History", exact: true }).click();
  await expect(writer.getByTestId("history-message")).toHaveCount(1);
  const reader = await browser.newPage(); await speechEngine(reader);
  await reader.goto(writer.url().split("#")[0]);
  await expect(reader.getByText("Invalid room link", { exact: true })).toBeVisible();
  await reader.goto(writer.url().split("#")[0] + "#key=" + "A".repeat(43));
  await expect(reader.getByRole("alert")).toContainText("Could not decrypt");
  await expect(reader.getByText("Only the intended key can read this", { exact: true })).toHaveCount(0);
  await expect(reader.getByTestId("push-to-talk")).toBeDisabled();
  await reader.goto(writer.url());
  await expect(reader.getByTestId("message")).toHaveText("Only the intended key can read this");
  await writer.close(); await reader.close();
});

test("web and Swift CryptoKit exchange encrypted messages through the real Worker", async ({ page, baseURL }) => {
  test.skip(process.platform !== "darwin", "CryptoKit interoperability runs on macOS");
  test.setTimeout(60_000);
  await speechEngine(page); await page.goto("/");
  await hold(page); await say(page, "Browser encrypted hello 👋"); await page.mouse.up();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByTestId("history-message")).toHaveCount(1);
  await page.keyboard.press("Escape");
  const url = new URL(page.url());
  await run("swift", ["test", "--package-path", "native/Core", "--filter", "browserAndSwiftExchangeEncryptedMessages"], {
    env: { ...process.env, TALK_BUGS_TEST_SERVER: baseURL, TALK_BUGS_INTEROP_ROOM: url.pathname.split("/")[2], TALK_BUGS_INTEROP_KEY: url.hash.slice(5) },
  });
  await expect(page.getByTestId("message").filter({ hasText: "Swift encrypted reply ✓" })).toHaveAttribute("data-status", "final");
});
