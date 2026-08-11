import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  description,
  icon: Icon,
  delta,
  deltaSuffix,
  invertDelta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  description: string;
  icon: LucideIcon;
  delta?: number | null;
  deltaSuffix?: string;
  invertDelta?: boolean;
  tone?: "neutral" | "healthy" | "attention" | "highrisk" | "critical";
}) {
  const toneRing: Record<string, string> = {
    neutral: "bg-neutral-info-soft text-neutral-info",
    healthy: "bg-healthy-soft text-healthy",
    attention: "bg-attention-soft text-attention-foreground",
    highrisk: "bg-highrisk-soft text-highrisk",
    critical: "bg-critical-soft text-critical",
  };
  const hasDelta = delta !== undefined && delta !== null && Number.isFinite(delta);
  const positive = hasDelta ? (invertDelta ? delta! < 0 : delta! > 0) : false;
  const neutralDelta = hasDelta && Math.abs(delta!) < 0.05;
  const DeltaIcon = neutralDelta ? Minus : positive ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="card-surface flex flex-col gap-3 p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <p className="min-w-0 text-sm font-medium text-muted-foreground">{label}</p>
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", toneRing[tone])}>
          <Icon className="size-4.5" aria-hidden />
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-display text-3xl leading-none font-bold">{value}</span>
        {hasDelta ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold",
              neutralDelta
                ? "bg-muted text-muted-foreground"
                : positive
                  ? "bg-healthy-soft text-healthy"
                  : "bg-critical-soft text-critical",
            )}
          >
            <DeltaIcon className="size-3" aria-hidden />
            {Math.abs(delta!).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
            {deltaSuffix ?? ""}
          </span>
        ) : null}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
