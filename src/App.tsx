import { useEffect, useRef, useState } from "react";
import { Check, HelpCircle, LoaderCircle, Mic, MicOff, Plus, Share, Square } from "lucide-react";
import { PushToTalk } from "@/components/push-to-talk";
import { Button } from "@/components/ui/button";
import { Incoming, RoomHistory } from "@/components/incoming";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useRoom } from "@/hooks/use-room";
import { useSpeech } from "@/hooks/use-speech";
import { validKey } from "@/lib/encryption";
import { UUID } from "../shared/protocol";

function Help({ encrypted }: { encrypted: boolean }) {
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
          <p>Anyone with the full invite link can read the room. {encrypted ? "Messages are end-to-end encrypted. Room history lasts up to 24 hours. Browser speech recognition may use its provider’s service." : "This older room is not encrypted. Start a new room to use encryption. Text is stored for up to 24 hours."}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Room({ roomId, secret }: { roomId: string; secret?: string }) {
  const room = useRoom(roomId, secret);
  const speech = useSpeech(room.publish, room.status === "connected");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [sharing, setSharing] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const speaking = speech.activity === "listening" || speech.activity === "starting";
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const invite = async () => {
    if (sharing) return;
    setSharing(true);
    setCopyError(false);
    setCopied(false);
    clearTimeout(copyTimer.current);
    try {
      if (navigator.share) {
        try {
          await navigator.share({ title: "talk-bugs", url: location.href });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyError(true);
    } finally {
      setSharing(false);
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
            <Button variant="outline" size="icon" aria-label={copied ? "Link copied" : "Share room"} title={copied ? "Link copied" : "Share room"} disabled={sharing} onClick={() => void invite()}>{copied ? <Check /> : <Share />}</Button>
            <RoomHistory messages={room.messages} selfID={room.self?.id} />
            <Help encrypted={!!secret} />
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
          </div>
          {speech.support === "unsupported" && <p className="text-sm text-muted-foreground">This browser doesn’t support speech recognition. Open this link in a supported browser to speak.</p>}
          {(speech.error || room.error) && <p role="alert" className="text-sm text-destructive">{speech.error || room.error}</p>}
        </CardFooter>
      </Card>
    </main>
  );
}

export default function App() {
  const [address, setAddress] = useState(() => new URL(location.href));
  useEffect(() => {
    const changed = () => setAddress(new URL(location.href));
    window.addEventListener("hashchange", changed);
    window.addEventListener("popstate", changed);
    return () => { window.removeEventListener("hashchange", changed); window.removeEventListener("popstate", changed); };
  }, []);
  const match = address.pathname.match(/^\/(r|e)\/([^/]+)\/?$/);
  const secret = address.hash.startsWith("#key=") ? address.hash.slice(5) : "";
  if (match && UUID.test(match[2])) {
    if (match[1] === "r" && !address.hash) return <Room key={address.pathname} roomId={match[2].toLowerCase()} />;
    if (match[1] === "e" && validKey(secret)) return <Room key={address.pathname + address.hash} roomId={match[2].toLowerCase()} secret={secret} />;
  }
  return (
    <main className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader><CardTitle><h1>Invalid room link</h1></CardTitle><CardDescription>Ask for the full invite link, including the part after #, or start a new room.</CardDescription></CardHeader>
        <CardFooter><Button asChild><a href="/">New room</a></Button></CardFooter>
      </Card>
    </main>
  );
}
