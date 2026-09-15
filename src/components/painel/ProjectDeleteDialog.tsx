import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";

import { deleteProjectAdmin, previewProjectDelete } from "@/lib/project-delete.functions";
import { canConfirmProjectDelete, PROJECT_DELETE_CONFIRM_WORD } from "@/lib/project-delete.shared";
import type { PreviewAdminDeleteProjectResult } from "@/lib/project-delete.server";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const PROJECT_DELETE_INVALIDATED_QUERY_KEYS = [
  ["projects"],
  ["clients"],
] as const;

/**
 * Diálogo administrativo de exclusão de projeto (GATE 11B). Só é montado
 * quando o admin clica em "Excluir projeto" — o preview server-side é
 * carregado nesse momento, nunca antes. Redireciona para /projetos quando a
 * exclusão acontece a partir da tela de detalhe (onDeleted).
 */
export function ProjectDeleteDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
  onDeleted,
}: {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const previewFn = useServerFn(previewProjectDelete);
  const deleteFn = useServerFn(deleteProjectAdmin);

  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (open) return;
    setConfirmText("");
  }, [open]);

  const preview = useQuery({
    queryKey: ["project-delete-preview", projectId],
    enabled: open,
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<PreviewAdminDeleteProjectResult> =>
      previewFn({ data: { projectId } }),
  });

  const del = useMutation({
    mutationFn: async () => deleteFn({ data: { projectId } }),
    onSuccess: () => {
      for (const key of PROJECT_DELETE_INVALIDATED_QUERY_KEYS) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success("Projeto excluído com sucesso.");
      setConfirmText("");
      onOpenChange(false);
      onDeleted?.();
      void navigate({ to: "/projetos" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const impact = preview.data;
  const canConfirm = canConfirmProjectDelete({
    canDelete: impact?.can_delete,
    confirmText,
    isPending: del.isPending,
  });

  return (
    <Dialog open={open} onOpenChange={(v) => (del.isPending ? null : onOpenChange(v))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Excluir projeto</DialogTitle>
          <DialogDescription>
            Esta ação remove o projeto definitivamente. Só é permitida quando não há nenhuma
            reunião, ação, risco, decisão ou oportunidade vinculada.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Projeto" value={impact?.project_name ?? projectName} />
            <Row label="Cliente" value={impact?.client_name ?? "—"} />
          </dl>

          {preview.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Carregando prévia do impacto…
            </p>
          ) : null}

          {preview.isError ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden />
              <AlertTitle>Não foi possível carregar a prévia</AlertTitle>
              <AlertDescription>{(preview.error as Error).message}</AlertDescription>
            </Alert>
          ) : null}

          {impact ? (
            <div className="grid gap-3">
              <div className="grid gap-1 text-sm">
                <p className="font-semibold">Dependências encontradas</p>
                <CountRow label="Reuniões" value={impact.counts.meetings} />
                <CountRow label="Ações" value={impact.counts.actions} />
                <CountRow label="Riscos" value={impact.counts.risks} />
                <CountRow label="Decisões" value={impact.counts.decisions} />
                <CountRow label="Oportunidades" value={impact.counts.opportunities} />
                <CountRow label="Aplicações de análise" value={impact.counts.analysis_applications} />
                <p className="text-muted-foreground">
                  Recomendações do orquestrador (não bloqueiam):{" "}
                  <span className="font-medium text-foreground">
                    {impact.counts.orchestrator_recommendations}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  Contexto do projeto:{" "}
                  <span className="font-medium text-foreground">
                    {impact.project_context_is_empty ? "vazio" : "com conteúdo preenchido"}
                  </span>
                </p>
              </div>

              {impact.can_delete === false ? (
                <Alert variant="destructive">
                  <AlertTriangle className="size-4" aria-hidden />
                  <AlertTitle>Este projeto não pode ser excluído</AlertTitle>
                  <AlertDescription>
                    {impact.blocking_reason ?? "O sistema não identificou o motivo específico."}
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="project-delete-confirm">
                    Digite{" "}
                    <span className="font-mono font-semibold">{PROJECT_DELETE_CONFIRM_WORD}</span>{" "}
                    para confirmar.
                  </Label>
                  <Input
                    id="project-delete-confirm"
                    autoComplete="off"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    disabled={del.isPending}
                  />
                </div>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={del.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canConfirm}
            onClick={() => del.mutate()}
          >
            {del.isPending ? "Excluindo…" : "Excluir projeto definitivamente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <p className="text-muted-foreground">
      {label}: <span className="font-medium text-foreground">{value}</span>
    </p>
  );
}
