import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";

import { adminUndoMeeting, previewAdminUndoMeeting } from "@/lib/meeting-undo.functions";
import { isPostUndoFailure } from "@/lib/meeting-undo.shared";
import type { PreviewAdminUndoMeetingResult } from "@/lib/meeting-undo.server";
import { projectQuery } from "@/lib/projects";
import { formatDate, type Meeting } from "@/lib/domain";
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

export const UNDO_CONFIRM_WORD = "EXCLUIR";

export const MEETING_UNDO_INVALIDATED_QUERY_KEYS = [
  ["meetings"],
  ["clients"],
  ["actions"],
  ["risks"],
  ["opportunities"],
] as const;

/**
 * Regra pura de habilitação do botão destrutivo — extraída para ser testável
 * sem precisar renderizar o componente (o projeto não tem uma lib de teste de
 * DOM). Nunca habilita se o preview bloqueou, se o texto de confirmação não
 * é exatamente "EXCLUIR", ou se já sabemos que o undo aconteceu e só o
 * recálculo falhou (não repetir o undo sobre uma reunião já excluída).
 */
export function canConfirmMeetingUndo(params: {
  blockedAfterUndo: boolean;
  allowed: boolean | undefined;
  confirmText: string;
  isPending: boolean;
}): boolean {
  return (
    !params.blockedAfterUndo &&
    params.allowed === true &&
    params.confirmText === UNDO_CONFIRM_WORD &&
    !params.isPending
  );
}

export function MeetingUndoDialog({
  meeting,
  clientName,
  open,
  onOpenChange,
  onSuccess,
}: {
  meeting: Meeting;
  clientName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess?: () => void;
}) {
  const queryClient = useQueryClient();
  const previewFn = useServerFn(previewAdminUndoMeeting);
  const undoFn = useServerFn(adminUndoMeeting);

  const [confirmText, setConfirmText] = useState("");
  const [blockedAfterUndo, setBlockedAfterUndo] = useState(false);

  useEffect(() => {
    if (open) return;
    setConfirmText("");
    setBlockedAfterUndo(false);
  }, [open]);

  const preview = useQuery({
    queryKey: ["meeting-undo-preview", meeting.id],
    enabled: open,
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<PreviewAdminUndoMeetingResult> =>
      previewFn({ data: { meetingId: meeting.id } }),
  });

  const undo = useMutation({
    mutationFn: async () => undoFn({ data: { meetingId: meeting.id } }),
    onSuccess: () => {
      for (const key of MEETING_UNDO_INVALIDATED_QUERY_KEYS) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success("Reunião desfeita com sucesso.");
      setConfirmText("");
      setBlockedAfterUndo(false);
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (e: Error) => {
      // Se o undo já foi confirmado no banco e só o recálculo falhou, a
      // reunião já não existe mais — nunca oferecer "tentar de novo", que
      // chamaria admin_undo_meeting sobre um registro já excluído.
      if (isPostUndoFailure(e.message)) {
        setBlockedAfterUndo(true);
      }
      toast.error(e.message);
    },
  });

  const impact = preview.data;

  // Nome do projeto — só busca quando o preview já trouxe o project_id;
  // reaproveita a mesma consulta usada em outras telas (projectQuery).
  const project = useQuery({
    ...projectQuery(impact?.project_id ?? ""),
    enabled: open && !!impact?.project_id,
  });
  const projectLabel = !impact?.project_id
    ? "Sem projeto vinculado"
    : project.isLoading
      ? "Carregando…"
      : (project.data?.name ?? "Não encontrado");

  const canConfirm = canConfirmMeetingUndo({
    blockedAfterUndo,
    allowed: impact?.allowed,
    confirmText,
    isPending: undo.isPending,
  });

  return (
    <Dialog open={open} onOpenChange={(v) => (undo.isPending ? null : onOpenChange(v))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Desfazer reunião</DialogTitle>
          <DialogDescription>
            Esta ação remove a reunião e reverte somente os efeitos que o sistema consegue
            comprovar com segurança.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Cliente" value={clientName} />
            <Row label="Projeto" value={projectLabel} />
            <Row label="Data" value={formatDate(meeting.meeting_date)} />
            <Row label="Tipo" value={meeting.meeting_type ?? "não informado"} />
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

          {blockedAfterUndo ? (
            <Alert variant="destructive">
              <ShieldAlert className="size-4" aria-hidden />
              <AlertTitle>A reunião já foi excluída</AlertTitle>
              <AlertDescription>
                O undo foi concluído no banco, mas o recálculo do cliente falhou depois. Não repita
                o undo — feche esta janela e peça para recalcular o cliente manualmente.
              </AlertDescription>
            </Alert>
          ) : impact ? (
            <div className="grid gap-3">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Row label="Análise aplicada" value={impact.applied ? "Sim" : "Não"} />
                <Row
                  label="Itens de contexto afetados"
                  value={String(impact.context_items_affected)}
                />
              </dl>

              <div className="grid gap-1 text-sm">
                <p className="font-semibold">Itens criados por esta reunião (serão removidos)</p>
                <ImpactRow label="Ações" counts={impact.entities.actions} />
                <ImpactRow label="Riscos" counts={impact.entities.risks} />
                <ImpactRow label="Oportunidades" counts={impact.entities.opportunities} />
                <ImpactRow label="Decisões" counts={impact.entities.decisions} />
              </div>

              {impact.allowed === false ? (
                <Alert variant="destructive">
                  <AlertTriangle className="size-4" aria-hidden />
                  <AlertTitle>Esta reunião não pode ser desfeita com segurança</AlertTitle>
                  <AlertDescription>
                    {impact.blocking_reason ?? "O sistema não identificou o motivo específico."}
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="undo-confirm">
                    Digite <span className="font-mono font-semibold">{UNDO_CONFIRM_WORD}</span> para
                    confirmar.
                  </Label>
                  <Input
                    id="undo-confirm"
                    autoComplete="off"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    disabled={undo.isPending}
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
            disabled={undo.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canConfirm}
            onClick={() => undo.mutate()}
          >
            {undo.isPending ? "Desfazendo…" : "Desfazer reunião"}
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

function ImpactRow({ label, counts }: { label: string; counts: { created: number; updated: number } }) {
  return (
    <p className="text-muted-foreground">
      {label}: <span className="font-medium text-foreground">{counts.created} criados</span>,{" "}
      <span className="font-medium text-foreground">{counts.updated} atualizados</span>
    </p>
  );
}
