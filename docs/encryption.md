# Encrypted rooms

New rooms keep message text on participants' devices. Cloudflare stores and forwards encrypted messages.

```text
Speech → text → encrypt       Cloudflare       decrypt → read
       your device          sealed messages     their device
```

## Invitations

```text
https://talkbugs.com/e/ROOM-ID#key=ROOM-KEY
                              └───────────┘
                              Stays on devices
```

- A room key is 32 random bytes, encoded as unpadded base64url (43 characters).
- The browser creates the key with `crypto.getRandomValues`. Apple clients use CryptoKit.
- The fragment is not part of HTTP requests. API requests and WebSocket frames never contain the room key.
- Sharing the **full** invitation shares the key and access to retained history. A copied link, browser history, clipboard, or the service used to share it can expose the key.
- Missing or malformed keys never fall back to plaintext. A wrong key cannot decrypt existing messages.
- The browser keeps the key in the invitation URL and memory. The Apple apps save it in device-only Keychain entries, accessible after first unlock. Debug simulator builds alone have an app-container fallback for unsigned installs.
- The iPhone passes the key to its paired Watch through WatchConnectivity. Old room keys remain available for pending recordings. Keys are also saved under their fingerprints, so correcting an invite cannot replace a pending recording’s key.

## Message format, version 1

The same format is used by Web Crypto and Apple CryptoKit:

| Field | Format |
| --- | --- |
| Algorithm | AES-256-GCM |
| Key | 32 bytes |
| Nonce (`sealed.iv`) | 12 fresh random bytes for **every encryption**, including partial updates |
| Authentication tag | 16 bytes |
| `sealed.ciphertext` | Ciphertext followed by tag; unpadded base64url |
| `sealed.v` | `1` |
| `text` | Empty string on the wire and in the encrypted room's database |
| Plaintext | UTF-8 transcript; at most 4,000 UTF-16 code units |

The additional authenticated data is the UTF-8 encoding of these lines, with LF separators and **no trailing newline**:

```text
talk-bugs:e2ee:v1
<lowercase room UUID>
<64-character lowercase speaker ID>
<lowercase utterance UUID>
<decimal revision>
<1 if final, otherwise 0>
```

The speaker ID is SHA-256 of the lowercase session UUID, encoded as lowercase hexadecimal. Room, sender, message ID, revision, and final flag are therefore bound to the encrypted text. A modified value fails decryption. A server-generated `interrupted` status still uses the original non-final value (`0`); it is a delivery status, not an authenticated claim from the speaker.

Web updates are encrypted in order before entering the retry queue. Retries reuse that encrypted envelope; a new encryption always gets a fresh nonce. Native retries may encrypt again with a fresh nonce, keeping the same message ID and revision. The server's existing deduplication rules apply.

## Server boundary

| Room | Page | API | Durable Object name |
| --- | --- | --- | --- |
| New, encrypted | `/e/<uuid>#key=…` | `/api/encrypted-rooms/<uuid>/…` | `e:<uuid>` |
| Older, plaintext | `/r/<uuid>` | `/api/rooms/<uuid>/…` | `<uuid>` |

The Worker sets the room mode from the API path and overwrites any client-provided mode header. Encrypted rooms reject plaintext; older rooms reject encrypted envelopes. The separate namespaces prevent accidental downgrade and keep older clients compatible with their existing rooms.

Each accepted encrypted update has an empty `text` column and a `sealed` JSON column in Durable Object SQLite. The additive schema change preserves existing history. Room IDs, participant IDs, revisions, final status, order, timing, and message sizes remain visible to the server. The app removes old messages after 24 hours; this is not a guarantee that every infrastructure backup disappears at that time.

## Watch recordings

```text
Watch audio ──WatchConnectivity──> iPhone
                                  │
                         local transcription
                                  │
                       encrypt with original room key
                                  │
                             Cloudflare
```

A queued recording stores its original room, session, encryption flag, and key fingerprint. Its key stays in Keychain, outside the job metadata. Changing rooms does not change the destination or key for an earlier recording. A missing key stops sending. A job from an older Watch that omits the encryption flag is rejected if the phone knows that room is encrypted.

Audio and pending plaintext transcripts can still exist locally while waiting for transcription or delivery. They are not uploaded to Cloudflare. Encryption here protects message transport and server storage; it does not claim that an unlocked participant device contains no readable data.

## What this protects—and what it does not

- It protects message content from the relay and its database, assuming the devices run the intended client code and the invite stays secret.
- Anyone with the key can read retained history. There is no forward secrecy, key rotation, participant revocation, or independently verified sender identity. Start a new room and share its link only with the intended people to change access.
- A later key leak can expose previously saved encrypted messages. Participants can copy readable messages.
- The server can still observe metadata, drop messages, or supply an incomplete or old history. Encryption does not prove delivery or freshness of a newly loaded history.
- A malicious website update, injected script, browser extension, or compromised device can access keys or readable messages. Web encryption still relies on trustworthy client code.
- Browser speech recognition may send audio to the browser vendor before text is encrypted. The existing on-device preference and browser fallback are unchanged. Native recognition stays local to the iPhone.
- Older plaintext rooms stay plaintext. Creating an encrypted room does not erase prior exposure of an older conversation.

## Verification

`npm test` checks tampering, wrong keys, authenticated metadata, nonce uniqueness, size limits, and protocol boundaries. Browser tests cover concurrent encrypted streams, reconnects, history, wrong/missing keys, and requests that contain neither keys nor plaintext.

On macOS, `npm run test:e2e -- tests/e2e/encryption.spec.ts` also sends a browser message through the real Worker to Swift CryptoKit, then reads Swift's encrypted reply in the browser. A shared test vector is in `native/Core/Tests/TalkBugsCoreTests/Fixtures/e2ee-v1.json`.

Native tests cover invitation parsing, key persistence, encrypted outbox routing, and app relaunch. Physical Watch audio transfer and locked-phone execution still require hardware validation. This implementation has not had an independent cryptographic audit.
