import { useEffect, useRef, useState } from "react";
import { ArrowDown, Check, Copy, HelpCircle, LoaderCircle, Mic, MicOff, Plus, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useRoom } from "@/hooks/use-room";
import { useSpeech } from "@/hooks/use-speech";
import { UUID } from "../shared/protocol";

function Help() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="How it works"><HelpCircle /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How it works</DialogTitle>
          <DialogDescription>Speak to send messages. Read what others say.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm text-muted-foreground">
          <p>Share the room link to invite people. Up to 24 people can join and speak at the same time.</p>
          <p>Click Start speaking to turn on your microphone. Words appear as you speak and may change while recognition finishes. Click Stop speaking to turn it off.</p>
          <Separator />
          <p>You need a browser with speech recognition to speak. Unsupported browsers can still read messages.</p>
          <p>Anyone with the link can read the room. Text is stored on Cloudflare for up to 24 hours. Messages are not end-to-end encrypted.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Room({ roomId }: { roomId: string }) {
  const room = useRoom(roomId);
  const speech = useSpeech(room.publish, room.status === "connected");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [scrolledUp, setScrolledUp] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const speaking = speech.activity === "listening" || speech.activity === "starting";
  const messages = room.messages.filter(message => message.text);

  useEffect(() => {
    if (nearBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [room.messages]);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const invite = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setCopyError(false);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyError(true);
    }
  };

  const buttonLabel = speech.support === "checking" ? "Checking speech support"
    : speech.support === "unsupported" ? "Speech unavailable"
    : speaking ? "Stop speaking"
    : speech.activity === "stopping" ? "Finishing your words" : "Start speaking";
  const disabled = room.status !== "connected"
    || ["checking", "unsupported"].includes(speech.support)
    || speech.activity === "stopping";
  const busy = speech.support === "checking"
    || speech.activity === "starting" || speech.activity === "stopping";
  const subtitle = room.status !== "connected" ? "Waiting for the room to connect."
    : speech.support === "unsupported" ? "This browser doesn’t support speech recognition. Open this link in a supported browser to speak."
    : speaking ? "Your microphone is on. Your words are shared as text."
    : "Your microphone is off.";

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col p-3 sm:p-6">
      <Card className="min-h-0 flex-1">
        <CardHeader>
          <CardTitle><h1>talk-bugs</h1></CardTitle>
          <CardDescription>
            {room.status === "connected" ? "Connected" : room.status === "closed" ? "Disconnected" : "Connecting…"}
          </CardDescription>
          <CardAction className="flex items-center gap-2">
            <Button asChild variant="outline" size="icon"><a href="/" aria-label="New room" title="New room"><Plus /></a></Button>
            <Button variant="outline" onClick={() => void invite()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Invite"}</Button>
            <Help />
          </CardAction>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
          {copyError && <p role="status" className="text-sm text-muted-foreground">Copy the room link from your browser’s address bar to invite someone.</p>}
          {room.participants.length > 0 && (
            <div className="flex max-h-24 shrink-0 flex-wrap gap-2 overflow-y-auto" aria-label="People in this room">
              {room.participants.map(person => (
                <Badge key={person.id} variant="secondary">
                  {room.messages.some(message => message.speaker.id === person.id && message.status === "live") && <Mic aria-label="Speaking" />}
                  {person.id === room.self?.id ? "You" : person.name}
                </Badge>
              ))}
            </div>
          )}
          <Separator />
          <div
            ref={scroll}
            className="min-h-0 flex-1 overflow-y-auto"
            onScroll={() => {
              const el = scroll.current!;
              nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
              setScrolledUp(!nearBottom.current);
            }}
          >
            {messages.length === 0 ? (
              <div className="flex min-h-full flex-col items-center justify-center gap-2 py-8 text-center text-sm">
                <h2 className="font-medium">No messages yet</h2>
                <p className="max-w-xs text-muted-foreground">{room.participants.length > 1 ? "Start speaking to send a message." : "Invite someone to join, then start speaking."}</p>
              </div>
            ) : (
              <div className="space-y-6" aria-label="Conversation">
                {messages.map(message => (
                  <article key={message.id} data-testid="message" data-status={message.status} aria-label={`${message.speaker.id === room.self?.id ? "You" : message.speaker.name}${message.status === "live" ? ", speaking" : ""}`}>
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium">{message.speaker.id === room.self?.id ? "You" : message.speaker.name}</span>
                      <time className="text-muted-foreground" dateTime={new Date(message.startedAt).toISOString()}>{new Date(message.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                      {message.status === "live" && <Badge variant="outline">Speaking</Badge>}
                      {message.status === "interrupted" && <span className="text-muted-foreground">Connection paused</span>}
                    </div>
                    <p className={`text-sm leading-relaxed [overflow-wrap:anywhere] ${message.status === "live" ? "text-muted-foreground" : ""}`}>{message.text}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
          {scrolledUp && (
            <Button variant="secondary" size="sm" className="self-center" onClick={() => {
              nearBottom.current = true;
              scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
            }}><ArrowDown />Latest messages</Button>
          )}
        </CardContent>

        <CardFooter className="flex-col items-stretch gap-3 border-t">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button aria-pressed={speaking} disabled={disabled} onClick={() => {
              if (speaking) speech.stop();
              else speech.start();
            }}>
              {busy ? <LoaderCircle className="motion-safe:animate-spin" /> : speech.support === "unsupported" ? <MicOff /> : speaking ? <Square /> : <Mic />}
              {buttonLabel}
            </Button>
            <span className="text-xs text-muted-foreground">English</span>
          </div>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
          {(speech.error || room.error) && <p role="alert" className="text-sm text-destructive">{speech.error || room.error}</p>}
          <span role="status" className="text-xs text-muted-foreground empty:hidden">{room.pending ? `${room.pending} phrase${room.pending > 1 ? "s" : ""} syncing…` : ""}</span>
        </CardFooter>
      </Card>
    </main>
  );
}

export default function App() {
  const match = location.pathname.match(/^\/r\/([^/]+)\/?$/);
  if (match && UUID.test(match[1])) return <Room roomId={match[1]} />;
  return (
    <main className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader><CardTitle><h1>Invalid room link</h1></CardTitle><CardDescription>Ask for the full invite link, or start a new room.</CardDescription></CardHeader>
        <CardFooter><Button asChild><a href="/">New room</a></Button></CardFooter>
      </Card>
    </main>
  );
}
