import { useCallback, useEffect, useRef, useState } from "react";
import { mergeMessage, type Message, type Participant, type ServerEvent, type Transcript, UUID } from "../../shared/protocol";

export function useRoom(roomId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [self, setSelf] = useState<Participant | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "reconnecting" | "closed">("connecting");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [session] = useState(() => {
    const key = `talk-bugs.session.${roomId}`;
    try {
      const saved = sessionStorage.getItem(key);
      if (saved && UUID.test(saved)) return saved;
      const id = crypto.randomUUID(); sessionStorage.setItem(key, id); return id;
    } catch { return crypto.randomUUID(); }
  });
  const [speakers, setSpeakers] = useState<Participant[]>([]);
  const socket = useRef<WebSocket | null>(null);
  const outbox = useRef(new Map<string, Transcript>());
  const sent = useRef(new Map<string, number>());
  const ready = useRef(false);

  const flush = useCallback(() => {
    const ws = socket.current;
    if (!ready.current || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 65_536) { ws.close(4000, "Connection is too slow"); return; }
    for (const update of outbox.current.values()) {
      if ((sent.current.get(update.utteranceId) ?? 0) >= update.revision) continue;
      ws.send(JSON.stringify(update));
      sent.current.set(update.utteranceId, update.revision);
    }
  }, []);

  const publish = useCallback((update: Transcript) => {
    outbox.current.set(update.utteranceId, update);
    setPending(outbox.current.size);
    if (update.final) flush();
  }, [flush]);

  useEffect(() => {
    const remember = (people: Participant[]) => setSpeakers(old => {
      const known = new Set(old.map(p => p.id));
      const added = people.filter(p => { if (known.has(p.id)) return false; known.add(p.id); return true; });
      return added.length ? [...old, ...added] : old;
    });
    let disposed = false;
    let retries = 0;
    let reconnect: ReturnType<typeof setTimeout>;
    let lastPong = Date.now();
    const connect = () => {
      if (disposed) return;
      ready.current = false;
      sent.current.clear();
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${scheme}//${location.host}/api/rooms/${roomId}/socket?session=${session}`);
      socket.current = ws;
      ws.onopen = () => { lastPong = Date.now(); };
      ws.onmessage = event => {
        if (disposed || socket.current !== ws) return;
        if (event.data === "pong") { lastPong = Date.now(); return; }
        let data: ServerEvent;
        try { data = JSON.parse(event.data) as ServerEvent; } catch { return; }
        if (data.type === "welcome") {
          remember(data.messages.filter(m => m.text).map(m => m.speaker));
          setSelf(data.self); setParticipants(data.participants); setMessages(data.messages);
          ready.current = true; retries = 0; setStatus("connected"); setError(""); flush();
        } else if (data.type === "message") {
          if (data.message.text) remember([data.message.speaker]); setMessages(old => mergeMessage(old, data.message));
        } else if (data.type === "presence") setParticipants(data.participants);
        else if (data.type === "ack") {
          const queued = outbox.current.get(data.utteranceId);
          if (queued && queued.revision <= data.revision) outbox.current.delete(data.utteranceId);
          sent.current.delete(data.utteranceId);
          setPending(outbox.current.size);
        } else if (data.type === "error") setError(data.message);
      };
      ws.onclose = event => {
        if (disposed || socket.current !== ws) return;
        ready.current = false;
        if ([4001, 1008, 1009].includes(event.code)) {
          setStatus("closed"); setError(event.reason || "Connection closed. Reload to rejoin."); return;
        }
        setStatus("reconnecting");
        if (++retries >= 5) setError("Still trying to reach the room. Check your connection; the room may also be full.");
        reconnect = setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(retries, 5)) + Math.random() * 350);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    const batching = setInterval(flush, 100);
    const heartbeat = setInterval(() => {
      const ws = socket.current;
      if (ws?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastPong > 35_000) ws.close(4000, "Connection lost");
      else ws.send("ping");
    }, 10_000);
    const online = () => {
      if (socket.current?.readyState === WebSocket.OPEN) return;
      clearTimeout(reconnect); connect();
    };
    window.addEventListener("online", online);
    return () => {
      disposed = true; ready.current = false;
      clearTimeout(reconnect); clearInterval(batching); clearInterval(heartbeat);
      window.removeEventListener("online", online);
      socket.current?.close(1000, "Left room");
    };
  }, [roomId, session, flush]);

  return { messages, participants, speakers, self, status, error, pending, publish };
}
