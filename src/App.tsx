import { useEffect, useRef, useState } from "react";
import { Check, Copy, HelpCircle, LoaderCircle, Mic, MicOff, Plus, Square } from "lucide-react";
import { PushToTalk } from "@/components/push-to-talk";
import { Button } from "@/components/ui/button";
import { Incoming, RoomHistory } from "@/components/incoming";
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
          <p>Hold the microphone button while speaking. Read the other people’s words here as they speak. Release to finish your turn. You can also hold Space or Enter when the button is focused.</p>
          <p>Each person has their own place. Their latest turn stays visible, with the previous turn below it. Open History to see the full conversation, including your words.</p>
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
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const speaking = speech.activity === "listening" || speech.activity === "starting";
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
    : speaking ? "Release to finish"
    : speech.activity === "stopping" ? "Finishing your words" : "Hold to talk";
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
          <CardAction className="flex items-center gap-1">
            <Button asChild variant="outline" size="icon"><a href="/" aria-label="New room" title="New room"><Plus /></a></Button>
            <Button variant="outline" onClick={() => void invite()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Invite"}</Button>
            <RoomHistory messages={room.messages} selfID={room.self?.id} />
            <Help />
          </CardAction>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
          {copyError && <p role="status" className="text-sm text-muted-foreground">Copy the room link from your browser’s address bar to invite someone.</p>}
          <Incoming speakers={room.speakers} participants={room.participants} messages={room.messages} selfID={room.self?.id} />
        </CardContent>

        <CardFooter className="flex-col items-stretch gap-3 border-t">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PushToTalk active={speaking} disabled={disabled} onPress={speech.start} onRelease={speech.stop}>
              {busy ? <LoaderCircle className="motion-safe:animate-spin" /> : speech.support === "unsupported" ? <MicOff /> : speaking ? <Square /> : <Mic />}
              {buttonLabel}
            </PushToTalk>
            <span className="text-xs text-muted-foreground">English</span>
          </div>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
          {(speech.error || room.error) && <p role="alert" className="text-sm text-destructive">{speech.error || room.error}</p>}
          <span role="status" className="min-h-4 text-xs text-muted-foreground">{room.pending ? `${room.pending} turn${room.pending > 1 ? "s" : ""} syncing…` : ""}</span>
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
