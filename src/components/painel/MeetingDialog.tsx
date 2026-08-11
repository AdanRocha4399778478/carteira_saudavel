import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { clientMeetingsQuery, recalculateClient } from "@/lib/api";
import {
  ERP_AREAS,
  MEETING_TYPES,
  byMeetingDateDesc,
  computeRisk,
  daysBetween,
  isOverdue,
  type ActionItem,
  type Client,
  type Meeting,
  type RiskRule,
} from "@/lib/domain";

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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { RiskBadge } from "@/components/painel/badges";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Form = {
  client_id: string;
  meeting_date: string;
  meeting_type: string;
  participants: string;
  executive_summary: string;
  satisfaction_score: number;
  satisfaction_justification: string;
  value_score: number;
  value_justification: string;
  measurable_result: string;
  main_pain: string;
  main_priority: string;
  main_result: string;
  next_action: string;
  action_owner: string;
  action_deadline: string;
  erp_area: string;
  expansion_opportunity: string;
  risk_description: string;
  explicit_complaint: boolean;
  continuity_doubt: boolean;
  low_client_adherence: boolean;
  missing_internal_owner: boolean;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

const empty: Form = {
  client_id: "",
  meeting_date: today(),
  meeting_type: "acompanhamento",
  participants: "",
  executive_summary: "",
  satisfaction_score: 7,
  satisfaction_justification: "",
  value_score: 7,
  value_justification: "",
  measurable_result: "",
  main_pain: "",
  main_priority: "",
  main_result: "",
  next_action: "",
  action_owner: "",
  action_deadline: "",
  erp_area: "",
  expansion_opportunity: "",
  risk_description: "",
  explicit_complaint: false,
  continuity_doubt: false,
  low_client_adherence: false,
  missing_internal_owner: false,
};

export function MeetingDialog({
  open,
  onOpenChange,
  clients,
  actions,
  riskRules,
  defaultClientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clients: Client[];
  actions: ActionItem[];
  riskRules: RiskRule[];
  defaultClientId?: string;
  /** Mantido por compatibilidade — o histórico é buscado por cliente. */
  meetings?: Meeting[];
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(empty);

  useEffect(() => {
    if (open) setForm({ ...empty, client_id: defaultClientId ?? "" });
  }, [open, defaultClientId]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const history = useQuery(clientMeetingsQuery(form.client_id));

  const preview = useMemo(() => {
    const previous = (history.data ?? []).slice().sort(byMeetingDateDesc);
    const overdue = actions.filter((a) => a.client_id === form.client_id && isOverdue(a)).length;
    return computeRisk(
      {
        satisfaction: form.satisfaction_score,
        valueScore: form.value_score,
        previousSatisfactions: previous
          .slice(0, 2)
          .map((m) => m.satisfaction_score)
          .filter((n): n is number => n !== null)
          .map(Number),
        hasMeasurableResult: form.measurable_result.trim().length > 0,
        overdueActions: overdue,
        // Intervalo entre a reunião anterior e a reunião registrada, não "hoje".
        daysSinceLastMeeting: daysBetween(previous[0]?.meeting_date ?? null, form.meeting_date),
        explicitComplaint: form.explicit_complaint,
        continuityDoubt: form.continuity_doubt,
        lowAdherence: form.low_client_adherence,
        missingInternalOwner: form.missing_internal_owner,
      },
      riskRules,
    );
  }, [form, history.data, actions, riskRules]);


  const mutation = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const { data: inserted, error } = await supabase
        .from("meetings")
        .insert({
          client_id: form.client_id,
          meeting_date: form.meeting_date,
          meeting_type: form.meeting_type,
          participants: form.participants
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
          executive_summary: form.executive_summary.trim() || null,
          satisfaction_score: form.satisfaction_score,
          satisfaction_justification: form.satisfaction_justification.trim() || null,
          value_score: form.value_score,
          value_justification: form.value_justification.trim() || null,
          measurable_result: form.measurable_result.trim() || null,
          has_measurable_result: form.measurable_result.trim().length > 0,
          main_pain: form.main_pain.trim() || null,
          main_priority: form.main_priority.trim() || null,
          main_result: form.main_result.trim() || null,
          next_action: form.next_action.trim() || null,
          action_owner: form.action_owner.trim() || null,
          action_deadline: form.action_deadline || null,
          expansion_opportunity: form.expansion_opportunity.trim() || null,
          explicit_complaint: form.explicit_complaint,
          continuity_doubt: form.continuity_doubt,
          low_client_adherence: form.low_client_adherence,
          missing_internal_owner: form.missing_internal_owner,
          calculated_risk_score: preview.score,
          calculated_risk_level: preview.level,
          created_by: auth.user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      const meetingId = inserted.id as string;

      if (form.next_action.trim()) {
        const { error: actionError } = await supabase.from("actions").insert({
          client_id: form.client_id,
          meeting_id: meetingId,
          description: form.next_action.trim(),
          owner_name: form.action_owner.trim() || null,
          deadline: form.action_deadline || null,
          priority: preview.level === "baixo" ? "média" : "alta",
          status: "não iniciada",
          erp_area: form.erp_area || null,
        });
        if (actionError) throw new Error(actionError.message);
      }

      if (form.risk_description.trim()) {
        const { error: riskError } = await supabase.from("risks").insert({
          client_id: form.client_id,
          meeting_id: meetingId,
          description: form.risk_description.trim(),
          level: preview.level,
        });
        if (riskError) throw new Error(riskError.message);
      }

      if (form.expansion_opportunity.trim()) {
        const { error: oppError } = await supabase.from("opportunities").insert({
          client_id: form.client_id,
          meeting_id: meetingId,
          description: form.expansion_opportunity.trim(),
          status: "mapeada",
        });
        if (oppError) throw new Error(oppError.message);
      }

      await recalculateClient(form.client_id, riskRules);
    },
    onSuccess: () => {
      for (const key of [
        ["meetings"],
        ["clients"],
        ["actions"],
        ["risks"],
        ["opportunities"],
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success("Reunião registrada e indicadores atualizados.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.client_id) {
      toast.error("Selecione o cliente da reunião.");
      return;
    }
    if (!form.meeting_date) {
      toast.error("Informe a data da reunião.");
      return;
    }
    mutation.mutate();
  }

  const flags: { key: keyof Form; label: string; help: string }[] = [
    {
      key: "explicit_complaint",
      label: "Reclamação explícita",
      help: "O cliente manifestou insatisfação de forma direta",
    },
    {
      key: "continuity_doubt",
      label: "Dúvida sobre continuidade",
      help: "Houve questionamento sobre manter a consultoria",
    },
    {
      key: "low_client_adherence",
      label: "Baixa adesão do cliente",
      help: "O cliente não executa o que foi combinado",
    },
    {
      key: "missing_internal_owner",
      label: "Ausência de responsável interno",
      help: "Não há dono do projeto dentro da empresa",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Registrar reunião</DialogTitle>
          <DialogDescription>
            O histórico é imutável: cada reunião cria um novo registro e recalcula os indicadores da
            conta.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Cliente *</Label>
            <Select value={form.client_id} onValueChange={(v) => set("client_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o cliente" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.company_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="date">Data da reunião *</Label>
            <Input
              id="date"
              type="date"
              value={form.meeting_date}
              onChange={(e) => set("meeting_date", e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label>Tipo de reunião</Label>
            <Select value={form.meeting_type} onValueChange={(v) => set("meeting_type", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEETING_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="participants">Participantes</Label>
            <Input
              id="participants"
              placeholder="Separe os nomes por vírgula"
              value={form.participants}
              onChange={(e) => set("participants", e.target.value)}
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="summary">Resumo executivo</Label>
            <Textarea
              id="summary"
              rows={3}
              value={form.executive_summary}
              onChange={(e) => set("executive_summary", e.target.value)}
            />
          </div>

          <Separator className="sm:col-span-2" />

          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label>Satisfação do empresário</Label>
              <span className="font-display text-lg font-bold">{form.satisfaction_score}</span>
            </div>
            <Slider
              value={[form.satisfaction_score]}
              min={0}
              max={10}
              step={1}
              onValueChange={(v) => set("satisfaction_score", v[0]!)}
            />
            <Textarea
              rows={2}
              placeholder="Justificativa da nota de satisfação"
              value={form.satisfaction_justification}
              onChange={(e) => set("satisfaction_justification", e.target.value)}
            />
          </div>
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label>Valor gerado pela consultoria</Label>
              <span className="font-display text-lg font-bold">{form.value_score}</span>
            </div>
            <Slider
              value={[form.value_score]}
              min={0}
              max={10}
              step={1}
              onValueChange={(v) => set("value_score", v[0]!)}
            />
            <Textarea
              rows={2}
              placeholder="Justificativa da nota de valor"
              value={form.value_justification}
              onChange={(e) => set("value_justification", e.target.value)}
            />
          </div>

          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="measurable">Resultado mensurável</Label>
            <Input
              id="measurable"
              placeholder="Ex.: redução de 12% no custo de estoque"
              value={form.measurable_result}
              onChange={(e) => set("measurable_result", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Deixe vazio se a reunião não apresentou resultado mensurável — isso soma pontos de
              risco.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pain">Principal dor</Label>
            <Input id="pain" value={form.main_pain} onChange={(e) => set("main_pain", e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="priority">Principal prioridade</Label>
            <Input
              id="priority"
              value={form.main_priority}
              onChange={(e) => set("main_priority", e.target.value)}
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="result">Principal resultado do período</Label>
            <Input
              id="result"
              value={form.main_result}
              onChange={(e) => set("main_result", e.target.value)}
            />
          </div>

          <Separator className="sm:col-span-2" />

          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="action">Próxima ação combinada</Label>
            <Input
              id="action"
              value={form.next_action}
              onChange={(e) => set("next_action", e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="owner">Responsável pela ação</Label>
            <Input
              id="owner"
              value={form.action_owner}
              onChange={(e) => set("action_owner", e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="deadline">Prazo da ação</Label>
            <Input
              id="deadline"
              type="date"
              value={form.action_deadline}
              onChange={(e) => set("action_deadline", e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Área do ERP</Label>
            <Select value={form.erp_area} onValueChange={(v) => set("erp_area", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a área" />
              </SelectTrigger>
              <SelectContent>
                {ERP_AREAS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="opportunity">Oportunidade de expansão</Label>
            <Input
              id="opportunity"
              value={form.expansion_opportunity}
              onChange={(e) => set("expansion_opportunity", e.target.value)}
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="riskdesc">Risco identificado</Label>
            <Input
              id="riskdesc"
              value={form.risk_description}
              onChange={(e) => set("risk_description", e.target.value)}
            />
          </div>

          <Separator className="sm:col-span-2" />

          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
            {flags.map((f) => (
              <div
                key={f.key}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{f.label}</p>
                  <p className="text-xs text-muted-foreground">{f.help}</p>
                </div>
                <Switch
                  checked={form[f.key] as boolean}
                  onCheckedChange={(v) => set(f.key, v as Form[typeof f.key])}
                />
              </div>
            ))}
          </div>

          <div className="card-surface grid gap-2 p-4 sm:col-span-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <p className="min-w-0 text-sm font-semibold">Risco calculado desta reunião</p>
              <RiskBadge level={preview.level} score={preview.score} />
            </div>
            {preview.reasons.length ? (
              <ul className="grid gap-1 text-xs text-muted-foreground">
                {preview.reasons.map((r) => (
                  <li key={r.label}>
                    • {r.label} <span className="font-semibold">(+{r.points})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhum critério de risco acionado nesta reunião.
              </p>
            )}
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Registrar reunião"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
