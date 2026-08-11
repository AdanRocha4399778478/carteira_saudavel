import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Flame,
  Hourglass,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Timer,
  TrendingDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "healthy" | "attention" | "highrisk" | "critical" | "neutral";

const toneClass: Record<Tone, string> = {
  healthy: "bg-healthy-soft text-healthy border-healthy/25",
  attention: "bg-attention-soft text-attention-foreground border-attention/40",
  highrisk: "bg-highrisk-soft text-highrisk border-highrisk/30",
  critical: "bg-critical-soft text-critical border-critical/30",
  neutral: "bg-neutral-info-soft text-neutral-info border-neutral-info/25",
};

export function Pill({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: Tone;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {children}
    </span>
  );
}

const riskMap: Record<string, { tone: Tone; icon: LucideIcon }> = {
  baixo: { tone: "healthy", icon: ShieldCheck },
  médio: { tone: "attention", icon: ShieldAlert },
  alto: { tone: "highrisk", icon: AlertTriangle },
  crítico: { tone: "critical", icon: Flame },
};

export function RiskBadge({ level, score }: { level: string; score?: number | null }) {
  const conf = riskMap[level] ?? { tone: "neutral" as Tone, icon: CircleDashed };
  return (
    <Pill tone={conf.tone} icon={conf.icon}>
      Risco {level}
      {score !== undefined && score !== null ? ` · ${score}` : ""}
    </Pill>
  );
}

const statusMap: Record<string, { tone: Tone; icon: LucideIcon }> = {
  saudável: { tone: "healthy", icon: ShieldCheck },
  atenção: { tone: "attention", icon: ShieldAlert },
  risco: { tone: "highrisk", icon: AlertTriangle },
  crítico: { tone: "critical", icon: Flame },
  encerrado: { tone: "neutral", icon: Lock },
};

export function AccountStatusBadge({ status }: { status: string }) {
  const conf = statusMap[status] ?? { tone: "neutral" as Tone, icon: CircleDashed };
  return (
    <Pill tone={conf.tone} icon={conf.icon}>
      {status}
    </Pill>
  );
}

const actionMap: Record<string, { tone: Tone; icon: LucideIcon }> = {
  "não iniciada": { tone: "neutral", icon: CircleDashed },
  "em andamento": { tone: "neutral", icon: Clock },
  concluída: { tone: "healthy", icon: CheckCircle2 },
  "aguardando cliente": { tone: "attention", icon: Hourglass },
  "aguardando consultoria": { tone: "attention", icon: Hourglass },
  bloqueada: { tone: "highrisk", icon: Lock },
  vencida: { tone: "critical", icon: Timer },
};

export function ActionStatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  const key = overdue ? "vencida" : status;
  const conf = actionMap[key] ?? { tone: "neutral" as Tone, icon: CircleDashed };
  return (
    <Pill tone={conf.tone} icon={conf.icon}>
      {overdue ? `vencida (${status})` : status}
    </Pill>
  );
}

export function TrendBadge({ trend }: { trend: string | null }) {
  if (!trend) return <span className="text-muted-foreground">—</span>;
  const tone: Tone = trend === "queda" ? "highrisk" : trend === "alta" ? "healthy" : "neutral";
  return (
    <Pill tone={tone} icon={trend === "queda" ? TrendingDown : CircleDashed}>
      {trend}
    </Pill>
  );
}

export function QuadrantBadge({ quadrant }: { quadrant: string | null }) {
  if (!quadrant) return <span className="text-muted-foreground">—</span>;
  const tone: Tone =
    quadrant === "Quadrante 1"
      ? "healthy"
      : quadrant === "Quadrante 2"
        ? "attention"
        : quadrant === "Quadrante 3"
          ? "highrisk"
          : "critical";
  return <Pill tone={tone}>{quadrant}</Pill>;
}
