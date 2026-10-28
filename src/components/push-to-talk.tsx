import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

// Capture the pointer so releasing outside the button still ends the turn.
export function PushToTalk({ disabled, active, onPress, onRelease, children }: {
  disabled: boolean; active: boolean; onPress: () => void; onRelease: () => void; children: ReactNode;
}) {
  const held = useRef<{ pointer: number } | { key: string } | null>(null);
  const releaseAction = useRef(onRelease);
  releaseAction.current = onRelease;
  const release = useCallback(() => {
    if (!held.current) return;
    held.current = null;
    releaseAction.current();
  }, []);
  useEffect(() => { if (disabled) release(); }, [disabled, release]);
  useEffect(() => {
    const hide = () => { if (document.hidden) release(); };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", hide);
    return () => {
      release();
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [release]);
  return <Button
    data-testid="push-to-talk"
    aria-pressed={active}
    disabled={disabled}
    variant="destructive"
    size="icon"
    className="size-28 rounded-full touch-none select-none aria-pressed:ring-4 aria-pressed:ring-destructive/25 [-webkit-touch-callout:none]"
    onContextMenu={event => event.preventDefault()}
    onPointerDown={event => {
      if (disabled || held.current || event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      held.current = { pointer: event.pointerId };
      onPress();
    }}
    onPointerUp={event => {
      if (held.current && "pointer" in held.current && held.current.pointer === event.pointerId) release();
    }}
    onPointerCancel={release}
    onLostPointerCapture={release}
    onBlur={release}
    onKeyDown={event => {
      if (event.key === "Escape") { release(); return; }
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      if (!disabled && !held.current && !event.repeat) {
        held.current = { key: event.key };
        onPress();
      }
    }}
    onKeyUp={event => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      if (held.current && "key" in held.current && held.current.key === event.key) release();
    }}
    onClick={event => event.preventDefault()}
  >{children}</Button>;
}
