import { useEffect, useRef } from "react";
import { useApp } from "../context/AppContext.js";

export function usePolling(
  refetch: () => Promise<void>,
  intervalMs = 5000,
  enabled = true
) {
  const { modalOpen } = useApp();
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(() => {
      // Skip if modal is open
      if (modalOpen) return;

      // Skip if user is focused on an input
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT")
      )
        return;

      // Skip if bulletin post is expanded
      if (document.querySelector(".bulletin-expand.open")) return;

      refetchRef.current();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs, enabled, modalOpen]);
}
