import { useEffect, useState } from "react";

/**
 * Generic interval polling. `fn` runs immediately and then every `interval`
 * ms while `enabled` is true. Returns the latest result and a refresh trigger.
 * When `key` changes, the result is reset to `initial` so a caller that now
 * queries a different resource never sees stale data from the previous one.
 */
export function usePoll<T>(
  fn: () => Promise<T>,
  deps: readonly unknown[],
  enabled = true,
  interval = 3000,
  initial: T,
  key?: unknown,
) {
  const [data, setData] = useState<T>(initial);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setData(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;

    const run = async () => {
      try {
        const result = await fn();
        if (active) setData(result);
      } catch {
        /* transient network errors — keep last known data */
      }
    };

    void run();
    const timer = setInterval(run, interval);

    return () => {
      active = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, interval, tick, ...deps]);

  return { data, refresh: () => setTick((t) => t + 1) };
}
