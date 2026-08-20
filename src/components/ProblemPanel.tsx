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
        "rounded-2xl border border-border bg-card shadow-sm transition-all duration-700 ease-out",
        compact ? "p-5" : "p-8",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-laser" />
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
          Problem statement
        </p>
      </div>
      <h2
        className={cn(
          "mt-3 font-display font-bold leading-tight tracking-tight transition-all duration-700",
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
