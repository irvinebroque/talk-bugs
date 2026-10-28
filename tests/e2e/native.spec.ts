import { test, expect } from '@playwright/test';
import WebSocket from 'ws';

test('HTTPS and web clients share messages, identities, presence, and idempotent retries', async ({ request }) => {
  const room = crypto.randomUUID();
  const token = crypto.randomUUID();
  const headers = { Authorization: `Bearer ${token}` };
  const base = `/api/rooms/${room}`;
  const initial = await request.get(`${base}/snapshot`, { headers });
  expect(initial.status()).toBe(200);
  const first = await initial.json();
  expect(first.self.name).toBe('Participant 1');
  const unchanged = await request.get(`${base}/snapshot`, { headers: { ...headers, 'If-None-Match': initial.headers().etag } });
  expect(unchanged.status()).toBe(304);
  const compressed = await request.get(`${base}/snapshot`, { headers: { ...headers, 'If-None-Match': `W/${initial.headers().etag}` } });
  expect(compressed.status()).toBe(304);
  const ws = new WebSocket(`ws://127.0.0.1:5173${base}/socket?session=${crypto.randomUUID()}`, { origin: 'http://127.0.0.1:5173' });
  const received: any[] = [];
  ws.on('message', data => received.push(JSON.parse(data.toString())));
  await expect.poll(() => received.find(e => e.type === 'welcome')?.participants.length).toBe(2);
  const id = crypto.randomUUID();
  const transcript = { type: 'transcript', utteranceId: id, revision: 1, text: 'From Apple Watch through the paired iPhone.', final: true, speaker: { id: 'spoof' } };
  expect((await request.post(`${base}/transcript`, { headers, data: transcript })).status()).toBe(200);
  await expect.poll(() => received.filter(e => e.type === 'message').length).toBe(1);
  const seen = received.find(e => e.type === 'message').message;
  expect(seen.speaker.id).toBe(first.self.id);
  await request.post(`${base}/transcript`, { headers, data: transcript });
  const snapshot = await (await request.get(`${base}/snapshot`, { headers })).json();
  expect(snapshot.messages).toHaveLength(1);
  expect(snapshot.messages[0].text).toBe(transcript.text);
  const incoming = { ...transcript, utteranceId: crypto.randomUUID(), text: 'From the browser.' };
  ws.send(JSON.stringify(incoming));
  await expect.poll(async () => (await (await request.get(`${base}/snapshot`, { headers })).json()).messages.length).toBe(2);
  await request.post(`${base}/leave`, { headers });
  await expect.poll(() => received.filter(e => e.type === 'presence').at(-1)?.participants.length).toBe(1);
  ws.close();
});

test('native HTTP refuses cross-origin, unauthenticated, audio, oversized, and malformed requests', async ({ request }) => {
  const base = `/api/rooms/${crypto.randomUUID()}`;
  const headers = { Authorization: `Bearer ${crypto.randomUUID()}` };
  expect((await request.get(`${base}/snapshot`)).status()).toBe(403);
  expect((await request.get(`${base}/snapshot`, { headers: { ...headers, Origin: 'https://evil.example' } })).status()).toBe(403);
  expect((await request.post(`${base}/transcript`, { headers: { ...headers, 'Content-Type': 'audio/wav' }, data: Buffer.from('audio') })).status()).toBe(415);
  expect((await request.post(`${base}/transcript`, { headers, data: { text: 'arbitrary' } })).status()).toBe(400);
  expect((await request.post(`${base}/transcript`, { headers: { ...headers, 'Content-Type': 'application/json' }, data: ' '.repeat(20_001) })).status()).toBe(413);
});

test('native presence expires even when the room has retained messages', async ({ request }) => {
  test.setTimeout(65_000);
  const base = `/api/rooms/${crypto.randomUUID()}`;
  const headers = { Authorization: `Bearer ${crypto.randomUUID()}` };
  const ws = new WebSocket(`ws://127.0.0.1:5173${base}/socket?session=${crypto.randomUUID()}`, { origin: 'http://127.0.0.1:5173' });
  const received: any[] = [];
  ws.on('message', data => received.push(JSON.parse(data.toString())));
  try {
    await expect.poll(() => received.find(e => e.type === 'welcome')?.participants.length).toBe(1);
    await request.post(`${base}/transcript`, { headers, data: { type: 'transcript', utteranceId: crypto.randomUUID(), revision: 1, text: 'Retained after presence expires', final: true } });
    await expect.poll(() => received.filter(e => e.type === 'presence').at(-1)?.participants.length).toBe(2);
    await expect.poll(() => received.filter(e => e.type === 'presence').at(-1)?.participants.length, { timeout: 55_000, intervals: [1000] }).toBe(1);
  } finally { ws.close(); }
});
