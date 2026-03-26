import { Star, TrendingUp, TrendingDown, Zap, Flag } from "lucide-react";
import { cn } from "@/lib/utils";

interface IconBadgeProps {
  className?: string;
}

export function IconPlayerBadge({ className }: IconBadgeProps) {
  return (
    <Star
      className={cn("w-3.5 h-3.5", className)}
      style={{ color: "var(--badge-icon)" }}
      fill="var(--badge-icon)"
    />
  );
}

export function BullishBadge({ className }: IconBadgeProps) {
  return (
    <TrendingUp className={cn("w-3.5 h-3.5", className)} style={{ color: "var(--badge-bullish)" }} />
  );
}

export function BearishBadge({ className }: IconBadgeProps) {
  return (
    <TrendingDown className={cn("w-3.5 h-3.5", className)} style={{ color: "var(--badge-bearish)" }} />
  );
}

export function HighVolatilityBadge({ className }: IconBadgeProps) {
  return (
    <Zap
      className={cn("w-3.5 h-3.5", className)}
      style={{ color: "var(--badge-hv)" }}
      fill="var(--badge-hv)"
    />
  );
}

type RiskFlagType = "injury" | "trade" | "legal" | "suspension" | string;

interface RiskFlagBadgeProps {
  type: RiskFlagType;
  note?: string;
  label?: string;
  className?: string;
}

export function RiskFlagBadge({ type, note, label, className }: RiskFlagBadgeProps) {
  const colorMap: Record<string, string> = {
    injury:     "var(--badge-injury)",
    trade:      "var(--badge-trade)",
    legal:      "var(--badge-legal)",
    suspension: "var(--badge-legal)",
    off_field:  "var(--badge-legal)",
    retirement: "var(--text-tertiary)",
  };
  const color = colorMap[type] ?? "var(--text-tertiary)";
  const displayLabel = label ?? type.toUpperCase();

  return (
    <span
      title={note}
      className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border", className)}
      style={{
        color,
        borderColor: color,
        backgroundColor: `${color}15`,
      }}
    >
      <Flag className="w-2.5 h-2.5" />
      {displayLabel}
    </span>
  );
}
