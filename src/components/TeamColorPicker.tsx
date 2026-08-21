import { TEAM_COLORS } from "@/lib/blind";
import { cn } from "@/lib/utils";

export function TeamColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {TEAM_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Use color ${color}`}
          onClick={() => onChange(color)}
          className={cn(
            "h-7 w-7 rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bone/70",
            value === color && "ring-2 ring-offset-2 ring-offset-card",
          )}
          style={{
            backgroundColor: color,
            boxShadow: value === color ? `0 0 0 2px ${color}` : undefined,
          }}
        />
      ))}
    </div>
  );
}
