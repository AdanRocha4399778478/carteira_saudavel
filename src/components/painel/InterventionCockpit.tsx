import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Pill } from "@/components/painel/badges";
import { EmptyState } from "@/components/painel/states";
import { HEALTH_TONE, PRIORITY_TONE } from "@/lib/health";
import { useProjectsHealth } from "@/lib/health-portfolio";
import { MOVEMENT_LABEL } from "@/lib/evolution";
import { Button } from "@/components/ui/button";

/**
 * Cockpit da carteira: projetos ordenados por prioridade de intervenção.
 * Toda a ordenação vem do motor determinístico em `@/lib/health`.
 */
export function InterventionCockpit({
  clientName,
  limit = 8,
}: {
  clientName: (id: string) => string;
  limit?: number;
}) {
  const { ranked, isLoading } = useProjectsHealth();

  if (isLoading) return <p className="text-sm text-muted-foreground">Calculando saúde dos projetos…</p>;

  const urgent = ranked.filter((r) => r.health.priority === "URGENTE" || r.health.priority === "ALTA");

  if (ranked.length === 0)
    return (
      <EmptyState
        title="Nenhum projeto consultivo cadastrado"
        description="Crie projetos para acompanhar saúde consultiva e prioridade de intervenção."
      />
    );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {urgent.length} projeto(s) exigem intervenção alta ou urgente de {ranked.length} no total.
      </p>
      <ul className="grid gap-2">
        {ranked.slice(0, limit).map((row) => (
          <li
            key={row.projectId}
            className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold">{row.projectName}</span>
                <Pill tone={PRIORITY_TONE[row.health.priority]}>{row.health.priority}</Pill>
                <Pill tone={HEALTH_TONE[row.health.status]}>
                  {row.health.score} · {row.health.status}
                </Pill>
                {row.health.movement ? (
                  <span className="text-xs text-muted-foreground">
                    {MOVEMENT_LABEL[row.health.movement]}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">{clientName(row.clientId)}</p>
              {row.health.reasons[0] ? (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                  <span className="min-w-0">{row.health.reasons[0]}</span>
                </p>
              ) : null}
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/projetos/$projectId" params={{ projectId: row.projectId }}>
                Abrir projeto
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
