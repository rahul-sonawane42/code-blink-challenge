import { cn } from "@/lib/utils";

export function ProblemPanel({
  title,
  statement,
  compact,
}: {
  title: string;
  statement: string;
  compact: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card/80 backdrop-blur transition-all duration-700 ease-out",
        compact ? "p-4" : "p-8",
      )}
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
        Problem statement
      </p>
      <h2
        className={cn(
          "mt-2 font-semibold leading-tight transition-all duration-700",
          compact ? "text-lg" : "text-3xl",
        )}
      >
        {title}
      </h2>
      <p
        className={cn(
          "mt-4 whitespace-pre-wrap text-muted-foreground transition-all duration-700",
          compact ? "text-xs leading-relaxed" : "text-base leading-relaxed",
        )}
      >
        {statement || "The host has not published a statement yet."}
      </p>
    </section>
  );
}