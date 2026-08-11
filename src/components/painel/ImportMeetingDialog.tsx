import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileJson } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  clientMeetingsQuery,
  findSimilarMeetings,
  importMeetingTransaction,
  recalculateClient,
} from "@/lib/api";
import {
  formatDate,
  formatScore,
  isOverdue,
  type ActionItem,
  type Client,
  type Meeting,
  type RiskRule,
} from "@/lib/domain";
import {
  IMPORT_TEMPLATE,
  buildImportPlan,
  parseImportJson,
  type ImportPlan,
  type MeetingImportPayload,
} from "@/lib/meeting-import";
import { ClientCombobox } from "@/components/painel/ClientCombobox";
import { RiskBadge } from "@/components/painel/badges";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function ImportMeetingDialog({
  open,
  onOpenChange,
  clients,
  actions,
  riskRules,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clients: Client[];
  actions: ActionItem[];
  riskRules: RiskRule[];
  /** Mantido por compatibilidade — o histórico é buscado por cliente. */
  meetings?: Meeting[];
}) {
  const queryClient = useQueryClient();
  const [raw, setRaw] = useState("");
  const [clientId, setClientId] = useState("");
  const [payload, setPayload] = useState<MeetingImportPayload | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [autoMatch, setAutoMatch] = useState<"none" | "unique" | "ambiguous" | "missing">("none");
  const [duplicates, setDuplicates] = useState<Meeting[] | null>(null);
  const [confirmedDuplicate, setConfirmedDuplicate] = useState(false);

  useEffect(() => {
    if (open) return;
    setRaw("");
    setClientId("");
    setPayload(null);
    setErrors([]);
    setAutoMatch("none");
    setDuplicates(null);
    setConfirmedDuplicate(false);
  }, [open]);

  const history = useQuery(clientMeetingsQuery(clientId));
  const previousMeetings = history.data ?? [];

  function validate() {
    const result = parseImportJson(raw);
    if (!result.ok) {
      setErrors(result.errors);
      setPayload(null);
      return;
    }
    setErrors([]);
    setPayload(result.payload);
    setDuplicates(null);
    setConfirmedDuplicate(false);

    const target = norm(result.payload.empresa);
    const matches = clients.filter((c) => norm(c.company_name) === target);
    const partial =
      matches.length === 0
        ? clients.filter(
            (c) => norm(c.company_name).includes(target) || target.includes(norm(c.company_name)),
          )
        : matches;

    if (matches.length === 1) {
      setClientId(matches[0]!.id);
      setAutoMatch("unique");
    } else if (partial.length === 1) {
      setClientId(partial[0]!.id);
      setAutoMatch("unique");
    } else if (partial.length > 1) {
      setClientId("");
      setAutoMatch("ambiguous");
    } else {
      setClientId("");
      setAutoMatch("missing");
    }
  }

  const plan: ImportPlan | null = useMemo(() => {
    if (!payload || !clientId) return null;
    const dates = previousMeetings.map((m) => m.meeting_date).filter(Boolean);
    return buildImportPlan(payload, {
      clientId,
      riskRules,
      previousMeetingDates: dates,
      previousSatisfactions: previousMeetings
        .map((m) => m.satisfaction_score)
        .filter((n): n is number => n !== null)
        .slice(0, 2),
      overdueActions: actions.filter((a) => a.client_id === clientId && isOverdue(a)).length,
    });
  }, [payload, clientId, previousMeetings, riskRules, actions]);

  const mutation = useMutation({
    mutationFn: async (current: ImportPlan) => {
      const similar = await findSimilarMeetings({
        clientId,
        meetingDate: String(current.meeting["meeting_date"]),
        importHash: current.importHash,
      });
      if (similar.length > 0 && !confirmedDuplicate) {
        setDuplicates(similar);
        throw new Error("Uma reunião semelhante já existe para este cliente nesta data.");
      }
      const result = await importMeetingTransaction(current);
      await recalculateClient(clientId, riskRules);
      return result;
    },
    onSuccess: (result) => {
      for (const key of [["meetings"], ["clients"], ["actions"], ["risks"], ["opportunities"]]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success("Reunião importada com sucesso.", {
        description: `1 reunião criada · ${result.actions} ${result.actions === 1 ? "ação criada" : "ações criadas"} · ${result.risks} ${result.risks === 1 ? "risco registrado" : "riscos registrados"} · ${result.opportunities} ${result.opportunities === 1 ? "oportunidade registrada" : "oportunidades registradas"} · risco recalculado`,
      });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clientName = clients.find((c) => c.id === clientId)?.company_name ?? null;

  return (
    <Dialog open={open} onOpenChange={(v) => (mutation.isPending ? null : onOpenChange(v))}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar estruturação em JSON</DialogTitle>
          <DialogDescription>
            Cole a estruturação, valide, confira a prévia e confirme. Nada é gravado antes da
            confirmação.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <Label htmlFor="json">1. Estruturação em JSON *</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRaw(IMPORT_TEMPLATE)}
              >
                <FileJson className="size-4" aria-hidden />
                Usar modelo
              </Button>
            </div>
            <Textarea
              id="json"
              rows={12}
              className="font-mono text-xs"
              placeholder={IMPORT_TEMPLATE}
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setPayload(null);
                setDuplicates(null);
              }}
            />
            <div>
              <Button type="button" variant="outline" onClick={validate} disabled={!raw.trim()}>
                2. Validar estruturação
              </Button>
            </div>
          </div>

          {errors.length > 0 ? (
            <div className="rounded-xl bg-critical-soft p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="size-4" aria-hidden />
                Campos inválidos — nada será gravado
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {payload ? (
            <>
              <Separator />
              <div className="grid gap-2">
                <Label>Cliente *</Label>
                <ClientCombobox
                  clients={clients}
                  value={clientId}
                  onChange={(id) => {
                    setClientId(id);
                    setDuplicates(null);
                    setConfirmedDuplicate(false);
                  }}
                  disabled={mutation.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  JSON informa <strong>{payload.empresa}</strong>.{" "}
                  {autoMatch === "unique" && clientName
                    ? `Cliente reconhecido automaticamente: ${clientName}.`
                    : autoMatch === "ambiguous"
                      ? "Mais de um cliente semelhante — escolha manualmente."
                      : autoMatch === "missing"
                        ? "Nenhum cliente correspondente: selecione um existente ou cadastre o cliente antes de importar."
                        : ""}
                </p>
                {autoMatch === "missing" ? (
                  <Link
                    to="/clientes"
                    className="text-xs font-semibold underline"
                    onClick={() => onOpenChange(false)}
                  >
                    Cadastrar novo cliente
                  </Link>
                ) : null}
              </div>
            </>
          ) : null}

          {payload && plan ? (
            <div className="card-surface p-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 className="size-4" aria-hidden />
                3. Prévia da importação
              </p>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Row label="Cliente" value={clientName ?? "—"} />
                <Row label="Data da reunião" value={formatDate(payload.data_reuniao)} />
                <Row
                  label="Satisfação"
                  value={
                    payload.satisfacao.nota === null
                      ? "Não identificado"
                      : formatScore(payload.satisfacao.nota)
                  }
                />
                <Row
                  label="Valor gerado"
                  value={
                    payload.valor_gerado.nota === null
                      ? "Não identificado"
                      : formatScore(payload.valor_gerado.nota)
                  }
                />
                <Row
                  label="Risco informado pela análise"
                  value={payload.matriz_satisfacao_valor.risco_conta ?? "—"}
                />
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                  <dt className="text-muted-foreground">Risco calculado</dt>
                  <dd>
                    <RiskBadge level={plan.risk.level} score={plan.risk.score} />
                  </dd>
                </div>
                <Row label="Ações a criar" value={String(plan.actions.length)} />
                <Row label="Riscos a registrar" value={String(plan.risks.length)} />
                <Row label="Oportunidades a registrar" value={String(plan.opportunities.length)} />
                <Row
                  label="Resultado mensurável"
                  value={payload.valor_gerado.resultado_mensuravel ?? "Não informado"}
                />
                <Row
                  label="Próxima ação principal"
                  value={
                    payload.crm.proxima_acao ?? payload.matriz_satisfacao_valor.proxima_acao ?? "—"
                  }
                />
              </dl>

              {plan.warnings.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 rounded-xl bg-attention-soft p-3 pl-7 text-xs">
                  {plan.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {duplicates && duplicates.length > 0 ? (
            <div className="rounded-xl bg-attention-soft p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="size-4" aria-hidden />
                Uma reunião semelhante já existe para este cliente nesta data.
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                {duplicates.map((m) => (
                  <li key={m.id}>
                    {formatDate(m.meeting_date)} · satisfação {formatScore(m.satisfaction_score)} ·
                    valor {formatScore(m.value_score)}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link to="/clientes/$clientId" params={{ clientId }} onClick={() => onOpenChange(false)}>
                    Visualizar existente
                  </Link>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setConfirmedDuplicate(true);
                    setDuplicates(null);
                  }}
                >
                  Importar mesmo assim
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!plan || mutation.isPending || history.isLoading}
            onClick={() => plan && mutation.mutate(plan)}
          >
            {mutation.isPending ? "Importando…" : "4. Confirmar importação"}
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
      <dd className="truncate font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}
