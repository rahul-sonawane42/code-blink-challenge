import { useEffect, useState } from "react";

/**
 * Deadline-based countdown. Because the source of truth is an absolute epoch
 * timestamp (persisted to localStorage and derived from the host's
 * `started_at`), a page reload recovers the exact remaining time.
 */
export function useCountdown(deadline: number | null) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadline]);

  const remaining = deadline === null ? null : Math.max(0, deadline - now);
  return { remaining, expired: remaining !== null && remaining <= 0 };
}