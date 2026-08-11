import { Activity, ChevronRight } from "lucide-react";
import { Pill } from "@/components/painel/badges";
import { MOVEMENT_LABEL } from "@/lib/evolution";
import {
  HEALTH_CONFIG,
  HEALTH_TONE,
  PRIORITY_TONE,
  type ProjectHealth,
} from "@/lib/health";
import { cn } from "@/lib/utils";

function barTone(score: number) {
  if (score >= HEALTH_CONFIG.statusThresholds.saudavel) return "bg-healthy";
  if (score >= HEALTH_CONFIG.statusThresholds.atencao) return "bg-attention";
  if (score >= HEALTH_CONFIG.statusThresholds.risco) return "bg-highrisk";
  return "bg-critical";
}

export function HealthScoreRing({ health }: { health: ProjectHealth }) {
  return (
    <div className="flex items-center gap-4">
      <div className="grid size-20 shrink-0 place-items-center rounded-full border-4 border-border">
        <span className="text-2xl font-bold">{health.score}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Pill tone={HEALTH_TONE[health.status]} icon={Activity}>
          Saúde {health.status}
        </Pill>
        <Pill tone={PRIORITY_TONE[health.priority]}>Intervenção {health.priority}</Pill>
        {health.movement ? (
          <span className="text-xs text-muted-foreground">
            Movimento: {MOVEMENT_LABEL[health.movement]}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Índice de saúde consultiva com o detalhamento auditável do cálculo. */
export function ProjectHealthCard({ health }: { health: ProjectHealth }) {
  return (
    <section className="card-surface min-w-0 p-4 md:p-5">
      <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Saúde consultiva</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Índice 0 a 100 calculado por regras determinísticas — sem estimativa de IA.
          </p>
          <HealthScoreRing health={health} />
        </div>

        <div className="flex min-w-0 flex-col gap-2.5">
          {health.dimensions.map((d) => (
            <div key={d.key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium">
                  {d.label}{" "}
                  <span className="text-muted-foreground">· peso {d.weight}%</span>
                </span>
                <span className={cn("font-semibold", !d.available && "text-muted-foreground")}>
                  {d.available ? `${d.score}/100` : "sem dado"}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", d.available ? barTone(d.score ?? 0) : "bg-border")}
                  style={{ width: `${d.available ? (d.score ?? 0) : 0}%` }}
                />
              </div>
              {d.reasons.length ? (
                <p className="mt-1 text-xs text-muted-foreground">{d.reasons.join(" · ")}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {health.reasons.length ? (
        <div className="mt-4 rounded-xl border border-border bg-muted/40 p-3">
          <p className="text-xs font-semibold">Por que o índice não está maior</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {health.reasons.slice(0, 6).map((r) => (
              <li key={r} className="flex gap-1.5 text-xs text-muted-foreground">
                <ChevronRight className="mt-0.5 size-3 shrink-0" aria-hidden />
                <span className="min-w-0">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Nenhum ponto de atenção relevante identificado neste momento.
        </p>
      )}
    </section>
  );
}
