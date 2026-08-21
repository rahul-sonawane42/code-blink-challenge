import { Check, HeartCrack } from "lucide-react";
import { cn } from "@/lib/utils";

const PARTICLES = [
  { x: 20, y: -24, d: 0 },
  { x: 48, y: -46, d: 0.06 },
  { x: 78, y: -30, d: 0.12 },
  { x: -16, y: -32, d: 0.03 },
  { x: -52, y: -18, d: 0.09 },
  { x: -80, y: -40, d: 0.15 },
  { x: 90, y: 8, d: 0.18 },
  { x: -92, y: 6, d: 0.2 },
];

function Particles({ color }: { color: string }) {
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden>
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="animate-burst absolute left-1/2 top-1/2 h-2 w-2 rounded-full"
          style={{
            backgroundColor: color,
            transform: `translate(${p.x}px, ${p.y}px)`,
            animationDelay: `${p.d}s`,
          }}
        />
      ))}
    </span>
  );
}

/**
 * Full-area moment for a host verdict. Success bursts a mint check ring;
 * a life lost breaks a red heart — each over the hidden code area.
 */
export function VerdictOverlay({ kind, label }: { kind: "success" | "lifelost"; label: string }) {
  const success = kind === "success";
  const color = success ? "var(--mint)" : "var(--ember)";
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center overflow-hidden rounded-xl bg-void/85 backdrop-blur-sm">
      <Particles color={color} />
      <div className="animate-verdict-in relative flex flex-col items-center">
        <span
          className="animate-pulse-ring absolute h-24 w-24 rounded-full border-2"
          style={{ borderColor: color }}
        />
        <span
          className={cn(
            "animate-pop flex h-20 w-20 items-center justify-center rounded-full",
            success ? "bg-mint/15" : "bg-ember/15",
          )}
          style={{ boxShadow: `0 0 40px -8px ${color}` }}
        >
          {success ? (
            <Check className="h-10 w-10 text-mint" strokeWidth={3} />
          ) : (
            <HeartCrack className="h-10 w-10 text-ember" strokeWidth={2.5} />
          )}
        </span>
        <p className="mt-5 font-display text-3xl font-extrabold tracking-tight" style={{ color }}>
          {success ? "Accepted" : "Life lost"}
        </p>
        <p className="mt-2 max-w-xs text-center font-mono text-xs uppercase tracking-[0.2em] text-ash">
          {label}
        </p>
      </div>
    </div>
  );
}
