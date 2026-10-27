import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_TEXT, type Transcript } from "../../shared/protocol";
import { browserRecognition, type BrowserRecognition } from "@/lib/speech";

export function useSpeech(publish: (update: Transcript) => void, connected: boolean) {
  const [support, setSupport] = useState<"checking" | "ready" | "unsupported">("checking");
  const [activity, setActivity] = useState<"idle" | "starting" | "listening" | "stopping">("idle");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const recognition = useRef<BrowserRecognition | null>(null);
  const local = useRef(false);
  const desired = useRef(false);
  const mounted = useRef(true);
  const restart = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const segments = useRef(new Map<number, Transcript>());
  const emit = useRef(publish);
  emit.current = publish;
  const lang = "en-US";

  const finish = useCallback(() => {
    for (const segment of segments.current.values()) {
      if (!segment.final) emit.current({ ...segment, revision: segment.revision + 1, final: true });
    }
    segments.current.clear();
  }, []);

  const stop = useCallback(() => {
    desired.current = false;
    clearTimeout(restart.current);
    if (recognition.current) {
      setActivity("stopping");
      recognition.current.stop();
    } else { finish(); setActivity("idle"); }
  }, [finish]);

  useEffect(() => {
    mounted.current = true;
    const Constructor = browserRecognition();
    let cancelled = false;
    const check = async () => {
      if (!Constructor) { setSupport("unsupported"); return; }
      let useLocal = false;
      try {
        if (Constructor.available && "processLocally" in new Constructor()) {
          useLocal = await Constructor.available({ langs: [lang], processLocally: true }) === "available";
        }
      } catch { /* Use standard recognition if the optional local check fails. */ }
      if (!cancelled) { local.current = useLocal; setSupport("ready"); }
    };
    void check();
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hide);
    return () => {
      cancelled = true; mounted.current = false; desired.current = false;
      clearTimeout(restart.current);
      document.removeEventListener("visibilitychange", hide);
      if (recognition.current) {
        recognition.current.onend = null; recognition.current.onresult = null;
        recognition.current.onerror = null; recognition.current.onstart = null;
        recognition.current.abort(); recognition.current = null;
      }
    };
  }, [stop]);

  useEffect(() => { if (!connected && desired.current) stop(); }, [connected, stop]);

  const start = () => {
    if (!connected || support !== "ready" || recognition.current) return;
    const Constructor = browserRecognition();
    if (!Constructor) { setSupport("unsupported"); return; }
    desired.current = true; setError(""); setPreview("");
    const begin = () => {
      if (!desired.current || !mounted.current) return;
      const speech = new Constructor();
      if ("processLocally" in speech) speech.processLocally = local.current;
      speech.lang = lang; speech.continuous = true; speech.interimResults = true; speech.maxAlternatives = 1;
      recognition.current = speech; segments.current.clear(); setActivity("starting");
      speech.onstart = () => { if (mounted.current) setActivity("listening"); };
      speech.onresult = event => {
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index];
          const old = segments.current.get(index);
          if (old?.final) continue;
          const fullText = result[0].transcript.trim();
          const text = fullText.slice(0, MAX_TEXT);
          const update: Transcript = { type: "transcript", utteranceId: old?.utteranceId ?? crypto.randomUUID(),
            revision: (old?.revision ?? 0) + 1, text, final: result.isFinal };
          segments.current.set(index, update); emit.current(update);
          setPreview(text);
          if (fullText.length >= MAX_TEXT) {
            setError("That phrase reached the length limit. Pause, then start speaking again.");
            desired.current = false; speech.stop();
          }
        }
        // Browsers may retract an interim result entirely.
        for (const [index, segment] of segments.current) {
          if (index >= event.results.length && !segment.final) {
            emit.current({ ...segment, revision: segment.revision + 1, text: "", final: true });
            segments.current.delete(index);
          }
        }
      };
      speech.onerror = event => {
        if (event.error === "no-speech") return;
        desired.current = false;
        if (event.error === "language-not-supported") local.current = false;
        const errors: Record<string, string> = {
          "not-allowed": "Microphone access was denied. Allow it in your browser’s site settings, then try again.",
          "audio-capture": "No microphone is available. Connect one and try again.",
          "language-not-supported": "English speech recognition is unavailable. Please try again.",
          "service-not-allowed": "Speech recognition is blocked by this browser. Check your browser settings.",
          "network": "Speech recognition could not connect. Check your connection and try again.",
        };
        setError(errors[event.error] ?? "Speech recognition stopped. Please try again.");
      };
      speech.onend = () => {
        finish(); recognition.current = null;
        if (!mounted.current) return;
        setActivity("idle");
        if (desired.current) restart.current = setTimeout(begin, 350);
      };
      try { speech.start(); } catch {
        recognition.current = null; desired.current = false; setActivity("idle");
        setError("Could not start the microphone. Please try again.");
      }
    };
    begin();
  };

  return { support, activity, error, preview, start, stop };
}
