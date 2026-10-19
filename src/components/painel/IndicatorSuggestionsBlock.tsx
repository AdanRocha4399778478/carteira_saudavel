/* ------------------------------------------------------------------ *
 * Indicadores de resultado — parte 4, Gate C (18/10/2026): bloco visual
 * do preview de aprovação com os indicadores sugeridos pela IA a partir
 * da fala. Cada sugestão vem com evidência literal e um seletor Anexar
 * existente / Criar novo / Ignorar — toda a lógica de rascunho e
 * validação é pura (ver src/lib/indicator-approval.ts); este componente
 * só renderiza o estado atual e repassa as edições pro diálogo.
 * ------------------------------------------------------------------ */

import { buildApprovedIndicators, type IndicatorDraft } from "@/lib/indicator-approval";
import type { IndicatorDirection, IndicatorPointBasis } from "@/lib/indicator-analysis";
import type { ExistingIndicatorForMatch, IndicatorSuggestionPlan } from "@/lib/indicator-match";
import { formatDate } from "@/lib/domain";
import { validateApprovedIndicator, type IndicatorSuggestion } from "@/lib/meeting-analysis";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const KIND_LABEL: Record<string, string> = {
  percentual: "Percentual",
  valor: "Valor",
  tempo: "Tempo",
  quantidade: "Quantidade",
};

const DIRECTION_LABEL: Record<string, string> = {
  maior_melhor: "Maior é melhor",
  menor_melhor: "Menor é melhor",
};

const ERROR_MESSAGE: Record<string, string> = {
  "nome vazio": "Nome do indicador vazio.",
  "kind inválido": "Tipo de indicador inválido.",
  "criar sem direção": "Escolha a direção para criar o indicador.",
  "anexar sem alvo": "Escolha a qual indicador existente anexar.",
  "value não finito": "Informe um valor válido (ex.: 12,5).",
  "basis ausente": "Escolha se o valor é medido ou estimado.",
  "measured_at inválida": "Data inválida.",
};

const ACTION_OPTIONS: { value: IndicatorDraft["action"]; label: string }[] = [
  { value: "attach", label: "Anexar existente" },
  { value: "create", label: "Criar novo" },
  { value: "skip", label: "Ignorar" },
];

/** Bloco com todos os indicadores sugeridos pela IA — [] (sem sugestão) não renderiza nada. */
export function IndicatorSuggestionsBlock({
  suggestions,
  plans,
  drafts,
  existingIndicators,
  meetingDate,
  disabled = false,
  onChange,
}: {
  suggestions: IndicatorSuggestion[];
  plans: IndicatorSuggestionPlan[];
  drafts: IndicatorDraft[];
  existingIndicators: ExistingIndicatorForMatch[];
  meetingDate: string;
  disabled?: boolean;
  onChange: (index: number, patch: Partial<IndicatorDraft>) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <section className="rounded-lg border p-3">
      <h3 className="text-sm font-semibold">Indicadores sugeridos</h3>
      <p className="text-xs text-muted-foreground">
        A IA identificou estes indicadores na fala. Escolha anexar a um já existente, criar um novo
        ou ignorar a sugestão.
      </p>
      <ul className="mt-3 space-y-3">
        {suggestions.map((suggestion, i) => (
          <IndicatorSuggestionRow
            key={i}
            suggestion={suggestion}
            plan={plans[i]!}
            draft={drafts[i]!}
            existingIndicators={existingIndicators}
            meetingDate={meetingDate}
            disabled={disabled}
            onChange={(patch) => onChange(i, patch)}
          />
        ))}
      </ul>
    </section>
  );
}

function IndicatorSuggestionRow({
  suggestion,
  plan,
  draft,
  existingIndicators,
  meetingDate,
  disabled = false,
  onChange,
}: {
  suggestion: IndicatorSuggestion;
  plan: IndicatorSuggestionPlan;
  draft: IndicatorDraft;
  existingIndicators: ExistingIndicatorForMatch[];
  meetingDate: string;
  disabled?: boolean;
  onChange: (patch: Partial<IndicatorDraft>) => void;
}) {
  const [item] = buildApprovedIndicators([suggestion], [draft]);
  const errors = validateApprovedIndicator(item!);

  return (
    <li className="rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{suggestion.name}</span>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {KIND_LABEL[suggestion.kind] ?? suggestion.kind}
        </Badge>
        {suggestion.unit && (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {suggestion.unit}
          </Badge>
        )}
        <Badge variant="outline" className="shrink-0 text-[10px]">
          Sugerido
        </Badge>
      </div>

      {suggestion.evidence && (
        <p className="mt-1 text-xs text-muted-foreground">Evidência: "{suggestion.evidence}"</p>
      )}

      {plan.ambiguous && (
        <p className="mt-1 text-xs text-muted-foreground">
          Mais de um indicador existente tem este nome e tipo. Escolha qual anexar, crie um novo de
          propósito ou ignore.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {ACTION_OPTIONS.map((o) => (
          <Button
            key={o.value}
            type="button"
            size="sm"
            variant={draft.action === o.value ? "default" : "outline"}
            disabled={disabled}
            onClick={() => onChange({ action: o.value })}
          >
            {o.label}
          </Button>
        ))}
      </div>

      {draft.action === "attach" && (
        <div className="mt-2 grid gap-1.5">
          <Label>Indicador existente *</Label>
          <Select
            value={draft.targetIndicatorId ?? ""}
            onValueChange={(v) => onChange({ targetIndicatorId: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Escolha o indicador" />
            </SelectTrigger>
            <SelectContent>
              {existingIndicators.map((ind) => (
                <SelectItem key={ind.id} value={ind.id}>
                  {ind.name} ({KIND_LABEL[ind.kind] ?? ind.kind})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {draft.action === "create" && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Direção *</Label>
            <Select
              value={draft.direction}
              onValueChange={(v) => onChange({ direction: v as IndicatorDirection })}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Escolha a direção" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="maior_melhor">{DIRECTION_LABEL["maior_melhor"]}</SelectItem>
                <SelectItem value="menor_melhor">{DIRECTION_LABEL["menor_melhor"]}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Base (linha de base, opcional)</Label>
            <Input
              inputMode="decimal"
              placeholder="Ex.: 1.234,5"
              value={draft.baselineValueText}
              disabled={disabled}
              onChange={(e) => onChange({ baselineValueText: e.target.value })}
            />
          </div>
        </div>
      )}

      {draft.action !== "skip" && (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label>Valor *</Label>
            <Input
              inputMode="decimal"
              placeholder="Ex.: 12,5"
              value={draft.valueText}
              disabled={disabled}
              onChange={(e) => onChange({ valueText: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Marca *</Label>
            <Select
              value={draft.basis}
              onValueChange={(v) => onChange({ basis: v as IndicatorPointBasis })}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Medido ou estimado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="medido">Medido</SelectItem>
                <SelectItem value="estimado">Estimado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Data</Label>
            <Input
              type="date"
              value={draft.measuredAt}
              disabled={disabled}
              onChange={(e) => onChange({ measuredAt: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Vazio usa a data da reunião ({formatDate(meetingDate)}).
            </p>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="mt-2 text-xs font-medium text-destructive">
          {errors.map((code) => (
            <li key={code}>{ERROR_MESSAGE[code] ?? code}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
