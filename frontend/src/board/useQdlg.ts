import { useEffect, useRef, useState, type RefObject } from "react";

const REDUCED =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Open/close a dash-kit `dialog.qdlg` modal with its fade (`.in`) and keep it
 * mounted until the exit animation ends. Returns the ref for the `<dialog>`
 * and whether to render it at all.
 */
export function useQdlg(open: boolean): {
  ref: RefObject<HTMLDialogElement>;
  mounted: boolean;
} {
  const ref = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open) {
      if (!dlg.open) dlg.showModal();
      if (REDUCED) dlg.classList.add("in");
      else
        requestAnimationFrame(() =>
          requestAnimationFrame(() => dlg.classList.add("in")),
        );
      return;
    }
    if (!dlg.open) return;
    dlg.classList.remove("in");
    const finish = () => {
      if (dlg.open) dlg.close();
      setMounted(false);
    };
    if (REDUCED) {
      finish();
      return;
    }
    const t = window.setTimeout(finish, 240);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  return { ref, mounted };
}
