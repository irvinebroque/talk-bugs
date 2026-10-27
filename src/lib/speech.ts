export type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
export interface BrowserRecognition {
  processLocally?: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechOptions = { langs: string[]; processLocally: true };
export interface RecognitionConstructor {
  new(): BrowserRecognition;
  available?: (options: SpeechOptions) => Promise<"available" | "downloadable" | "downloading" | "unavailable">;
}
export function browserRecognition(): RecognitionConstructor | null {
  const browser = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  if (!window.isSecureContext) return null;
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
}
