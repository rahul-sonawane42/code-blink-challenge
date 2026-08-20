import acmLogo from "@/assets/acm-logo.png";

/**
 * Sits on top of the textarea while a round is live: the blindfolded ACM owl
 * floats over a scanning grid so nobody can read the (already transparent) text.
 */
export function MascotOverlay({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center overflow-hidden rounded-xl grid-lines"
    >
      <div className="absolute inset-x-0 h-24 animate-scan bg-gradient-to-b from-transparent via-primary/10 to-transparent" />
      <div className="relative flex h-40 w-40 items-center justify-center">
        <span className="absolute h-32 w-32 animate-pulse-ring rounded-full border border-primary/40" />
        <span className="absolute h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <img
          src={acmLogo}
          alt=""
          width={512}
          height={512}
          loading="lazy"
          className="relative h-32 w-32 animate-float drop-shadow-[0_0_25px_oklch(0.78_0.145_187_/_0.45)]"
        />
      </div>
      <p className="mt-6 font-mono text-xs uppercase tracking-[0.35em] text-primary">
        {active ? "blind mode engaged" : "waiting for host"}
      </p>
      {active && (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          keep typing — your code is hidden<span className="animate-blink">_</span>
        </p>
      )}
    </div>
  );
}