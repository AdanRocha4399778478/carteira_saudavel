import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Compass, Info, X } from "lucide-react";
import { Pill } from "@/components/painel/badges";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { orchestratorQuery, setRecommendationStatus } from "@/lib/orchestrator";
import { buildOrchestratorState, type StateInput } from "@/lib/orchestrator/state";
import {
  AGENT_LABEL,
  RECOMMENDATION_STATUS_LABEL,
  STAGE_LABEL,
} from "@/lib/orchestrator/types";

/* ------------------------------------------------------------------ *
 * PRÓXIMA ATUAÇÃO RECOMENDADA
 *
 * O Orquestrador apenas recomenda. Aprovar registra que o consultor
 * concordou — nenhum agente é executado automaticamente.
 * ------------------------------------------------------------------ */

export function NextActionCard(props: StateInput & { projectId: string }) {
  const { projectId, ...input } = props;
  const queryClient = useQueryClient();
  const [analysisOpen, setAnalysisOpen] = useState(false);

  const state = useMemo(() => buildOrchestratorState(input), [input]);
  const rec = useQuery(orchestratorQuery(projectId, state));

  const decide = useMutation({
    mutationFn: async (status: "approved" | "rejected") => {
      if (!rec.data) return;
      await setRecommendationStatus(rec.data.id, status);
      return status;
    },
    onSuccess: (status) => {
      void queryClient.invalidateQueries({ queryKey: ["orchestrator"] });
      toast.success(
        status === "approved"
          ? "Atuação aprovada e registrada. Nenhum agente foi executado."
          : "Recomendação rejeitada.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data = rec.data;

  return (
    <section className="card-surface min-w-0 p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Compass className="size-4 text-muted-foreground" aria-hidden />
            Próxima atuação recomendada
          </h2>
          <p className="text-xs text-muted-foreground">
            Recomendação consultiva por regras determinísticas. A execução depende da sua aprovação.
          </p>
        </div>
        {data ? <Pill tone="neutral">{RECOMMENDATION_STATUS_LABEL[data.status]}</Pill> : null}
      </div>

      {rec.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Analisando o estado do projeto…</p>
      ) : rec.error ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Não foi possível calcular a próxima atuação: {(rec.error as Error).message}
        </p>
      ) : data ? (
        <>
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">
                  {AGENT_LABEL[data.recommended_agent]}
                </span>
                <Pill tone={data.confidence >= 0.8 ? "healthy" : "attention"}>
                  Confiança {Math.round(data.confidence * 100)}%
                </Pill>
                <Pill tone="neutral">{STAGE_LABEL[data.project_stage]}</Pill>
              </div>
              <p className="text-sm text-muted-foreground">{data.reason}</p>
              <p className="text-sm">
                <span className="font-medium">Resultado esperado: </span>
                <span className="text-muted-foreground">{data.expected_result}</span>
              </p>
              {data.evidence.length > 0 ? (
                <ul className="mt-1 grid gap-1">
                  {data.evidence.slice(0, 3).map((ev, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                      <span className="min-w-0">{ev}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 lg:flex-col">
              <Button variant="outline" size="sm" onClick={() => setAnalysisOpen(true)}>
                Ver análise
              </Button>
              <Button
                size="sm"
                className="gap-2"
                disabled={decide.isPending || data.status !== "suggested"}
                onClick={() => decide.mutate("approved")}
              >
                <Check className="size-4" aria-hidden /> Aprovar atuação
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={decide.isPending || data.status !== "suggested"}
                onClick={() => decide.mutate("rejected")}
              >
                <X className="size-4" aria-hidden /> Rejeitar
              </Button>
            </div>
          </div>

          <Dialog open={analysisOpen} onOpenChange={setAnalysisOpen}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Análise do Orquestrador</DialogTitle>
                <DialogDescription>
                  Estado atual, gargalo principal e evidências que sustentam a recomendação.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 text-sm">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Estágio atual</p>
                  <p>{STAGE_LABEL[data.project_stage]}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Principal gargalo</p>
                  <p>{data.main_bottleneck.description}</p>
                  <p className="text-xs text-muted-foreground">
                    Tipo: {data.main_bottleneck.type}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Agente recomendado</p>
                  <p>
                    {AGENT_LABEL[data.recommended_agent]} · confiança{" "}
                    {Math.round(data.confidence * 100)}%
                  </p>
                  <p className="text-muted-foreground">{data.reason}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Evidências</p>
                  <ul className="mt-1 grid gap-1">
                    {data.evidence.map((ev, i) => (
                      <li key={i} className="text-muted-foreground">
                        • {ev}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Agente alternativo</p>
                  {data.alternative_agent ? (
                    <>
                      <p>{AGENT_LABEL[data.alternative_agent]}</p>
                      <p className="text-muted-foreground">{data.alternative_reason}</p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Nenhuma alternativa relevante.</p>
                  )}
                </div>
                {data.erp_classification.area || data.erp_classification.process ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Classificação ERP</p>
                    <p className="text-muted-foreground">
                      Área: {data.erp_classification.area ?? "—"} · Processo:{" "}
                      {data.erp_classification.process ?? "—"}
                    </p>
                  </div>
                ) : null}
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </section>
  );
}
