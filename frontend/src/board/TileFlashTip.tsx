import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type Props = {
  anchorRef: React.RefObject<HTMLElement | null>;
  id: string;
  open: boolean;
  shake: boolean;
  children: React.ReactNode;
};

/**
 * Portaled error tip anchored above the prompt input (not the whole chart card).
 * Shakes once when `shake` flips on so the failure is easy to notice.
 */
export function TileFlashTip({ anchorRef, id, open, shake, children }: Props) {
  const tipRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const tipEl = tipRef.current;
    const tipWidth = tipEl?.offsetWidth ?? 280;
    const tipHeight = tipEl?.offsetHeight ?? 36;
    const margin = 12;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, margin + tipWidth / 2),
      window.innerWidth - margin - tipWidth / 2,
    );
    // Sit just above the prompt appendix; if clipped, tuck under its top edge.
    const above = rect.top - 8;
    const top = above - tipHeight < margin ? rect.top + 8 : above;
    setPosition({ top, left });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open, reposition, children, shake]);

  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  if (!open) return null;

  return createPortal(
    <span
      ref={tipRef}
      id={id}
      className={`aie-tile-flash-tip${shake ? " is-shake" : ""}`}
      role="alert"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        translate: "-50% -100%",
      }}
    >
      {children}
    </span>,
    document.body,
  );
}
