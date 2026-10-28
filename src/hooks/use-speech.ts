import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_TEXT, type Transcript } from "../../shared/protocol";
import { browserRecognition, type BrowserRecognition } from "@/lib/speech";
import { SpeechTurn } from "@/lib/speech-turn";

export function useSpeech(publish: (update: Transcript) => void, connected: boolean) {
  const [support, setSupport] = useState<"checking" | "ready" | "unsupported">("checking");
  const [activity, setActivity] = useState<"idle" | "starting" | "listening" | "stopping">("idle");
  const [error, setError] = useState("");
  const recognition = useRef<BrowserRecognition | null>(null);
  const local = useRef(false);
  const started = useRef(false);
  const desired = useRef(false);
  const mounted = useRef(true);
  const restart = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const turn = useRef<SpeechTurn | null>(null);
  const emit = useRef(publish);
  emit.current = publish;
  const lang = "en-US";

  const finish = useCallback(() => {
    const update = turn.current?.finish();
    if (update) emit.current(update);
    turn.current = null;
  }, []);

  const stop = useCallback(() => {
    desired.current = false;
    clearTimeout(restart.current);
    if (recognition.current) {
      setActivity("stopping");
      if (started.current) recognition.current.stop();
      else recognition.current.abort();
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
    clearTimeout(restart.current);
    desired.current = true; setError(""); turn.current = new SpeechTurn();
    const begin = () => {
      if (!desired.current || !mounted.current) return;
      const speech = new Constructor();
      if ("processLocally" in speech) speech.processLocally = local.current;
      speech.lang = lang; speech.continuous = true; speech.interimResults = true; speech.maxAlternatives = 1;
      recognition.current = speech; setActivity("starting");
      started.current = false;
      speech.onstart = () => {
        if (!desired.current || recognition.current !== speech) { speech.abort(); return; }
        started.current = true;
        if (mounted.current) setActivity("listening");
      };
      speech.onresult = event => {
        if (recognition.current !== speech) return;
        const update = turn.current?.update(event.results);
        if (update) emit.current(update);
        if (turn.current && turn.current.text.length >= MAX_TEXT) {
          setError("That turn reached the length limit. Release, then hold to talk again.");
          desired.current = false; speech.stop();
        }
      };
      speech.onerror = event => {
        if (recognition.current !== speech) return;
        if (event.error === "no-speech" || (event.error === "aborted" && !desired.current)) return;
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
        if (recognition.current !== speech) return;
        recognition.current = null; started.current = false;
        if (desired.current) turn.current?.restart(); else finish();
        if (!mounted.current) return;
        setActivity("idle");
        if (desired.current) restart.current = setTimeout(begin, 350);
      };
      try { speech.start(); } catch {
        recognition.current = null; desired.current = false; finish(); setActivity("idle");
        setError("Could not start the microphone. Please try again.");
      }
    };
    begin();
  };

  return { support, activity, error, start, stop };
}
