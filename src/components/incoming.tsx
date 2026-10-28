import { memo, useCallback, useEffect, useRef } from "react";
import { History } from "lucide-react";
import type { Message, Participant } from "../../shared/protocol";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const Speaker = memo(function Speaker({ person, current, previous, online }: {
  person: Participant; current?: Message; previous?: Message; online: boolean;
}) {
  const words = useRef<HTMLDivElement>(null);
  useEffect(() => { if (words.current) words.current.scrollTop = 0; }, [current?.id]);
  return <section data-testid="speaker" data-speaker={person.id} aria-label={person.name}
    className="flex h-full min-h-0 flex-col gap-3">
    <div className="flex h-5 shrink-0 items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{person.name}</span>
      <span>{current?.status === "live" ? "Speaking" : !online ? "Left room" : ""}</span>
    </div>
    <div ref={words} data-testid="speaker-words" className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]">
      {current ? <>
        <article data-testid="message" data-status={current.status} data-turn={current.id}>
          <p className="whitespace-pre-wrap text-xl leading-relaxed [overflow-wrap:anywhere]">{current.text}</p>
          {current.status === "interrupted" && <p className="mt-2 text-xs text-muted-foreground">Connection paused</p>}
        </article>
        {previous && <article data-testid="previous-message" className="mt-6 border-t pt-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{previous.text}</p>
        </article>}
      </> : <p className="text-sm text-muted-foreground">Waiting for them to speak.</p>}
    </div>
  </section>;
});

export function Incoming({ speakers, participants, messages, selfID }: {
  speakers: Participant[]; participants: Participant[]; messages: Message[]; selfID?: string;
}) {
  const others = selfID ? speakers.filter(p => p.id !== selfID) : [];
  return <div data-testid="incoming" aria-label="Incoming conversation" className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]">
    {others.length === 0 ? <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center text-sm">
      <h2 className="font-medium">{!selfID ? "Connecting…" : participants.some(p => p.id !== selfID) ? "Waiting for someone to speak" : "No one else here"}</h2>
      <p className="text-muted-foreground">{participants.some(p => p.id !== selfID) ? "Their words will appear here." : "Invite someone to join."}</p>
    </div> : <div className={others.length === 1 ? "h-full" : "grid h-full gap-6 divide-y [&>section+section]:pt-4"}
      style={others.length > 1 ? { gridAutoRows: "minmax(12rem, calc((100% - 1.5rem) / 2))" } : undefined}>
      {others.map(person => {
        const turns = messages.filter(m => m.speaker.id === person.id && m.text);
        return <Speaker key={person.id} person={person} current={turns.at(-1)} previous={turns.at(-2)}
          online={participants.some(p => p.id === person.id)} />;
      })}
    </div>}
  </div>;
}

export function RoomHistory({ messages, selfID }: { messages: Message[]; selfID?: string }) {
  // Scroll only when History opens. Live updates must never yank the reading position.
  const openAtLatest = useCallback((element: HTMLDivElement | null) => {
    if (element) element.scrollTop = element.scrollHeight;
  }, []);
  return <Dialog>
    <DialogTrigger asChild><Button variant="ghost" size="icon" aria-label="History"><History /></Button></DialogTrigger>
    <DialogContent className="flex max-h-[85dvh] min-h-0 flex-col">
      <DialogHeader><DialogTitle>History</DialogTitle><DialogDescription>The full conversation, including your words.</DialogDescription></DialogHeader>
      <div ref={openAtLatest} data-testid="history" className="min-h-0 overflow-y-auto space-y-6">
        {messages.filter(m => m.text).map(message => <article key={message.id} data-testid="history-message" data-status={message.status}>
          <div className="mb-1 flex gap-2 text-xs text-muted-foreground">
            <span>{message.speaker.id === selfID ? "You" : message.speaker.name}</span>
            <time dateTime={new Date(message.startedAt).toISOString()}>{new Date(message.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{message.text}</p>
        </article>)}
        {!messages.some(m => m.text) && <p className="text-sm text-muted-foreground">No messages yet.</p>}
      </div>
    </DialogContent>
  </Dialog>;
}
