import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import {
  formatNumberForInput,
  validateIndicatorForm,
  type IndicatorFormInput,
} from "@/lib/indicator-form";
import type { IndicatorRow } from "@/lib/indicators-data";
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

const FREQUENCY_LABEL: Record<string, string> = {
  semanal: "Semanal",
  mensal: "Mensal",
};

const empty: IndicatorFormInput = {
  name: "",
  kind: "",
  unit: "",
  direction: "",
  frequency: "",
  baselineValue: "",
  baselineAt: "",
  targetValue: "",
};

export function IndicatorDialog({
  open,
  onOpenChange,
  projectId,
  clientId,
  indicator,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  clientId: string;
  indicator?: IndicatorRow | null;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<IndicatorFormInput>(empty);

  useEffect(() => {
    if (!open) return;
    setForm(
      indicator
        ? {
            name: indicator.name,
            kind: indicator.kind,
            unit: indicator.unit ?? "",
            direction: indicator.direction,
            frequency: indicator.frequency ?? "",
            baselineValue: formatNumberForInput(indicator.baseline_value),
            baselineAt: indicator.baseline_at ?? "",
            targetValue: formatNumberForInput(indicator.target_value),
          }
        : empty,
    );
  }, [open, indicator]);

  const set = <K extends keyof IndicatorFormInput>(key: K, value: IndicatorFormInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: async (value: ReturnType<typeof validateIndicatorForm>) => {
      if (!value.ok) return;
      const payload = {
        client_id: clientId,
        project_id: projectId,
        name: value.value.name,
        kind: value.value.kind,
        unit: value.value.unit,
        direction: value.value.direction,
        frequency: value.value.frequency,
        baseline_value: value.value.baseline_value,
        baseline_at: value.value.baseline_at,
        target_value: value.value.target_value,
      };
      if (indicator) {
        const { error } = await supabase.from("indicators").update(payload).eq("id", indicator.id);
        if (error) {
          if (error.code === "23505") {
            throw new Error("Já existe um indicador com esse nome e tipo neste projeto.");
          }
          throw new Error(error.message);
        }
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("indicators")
        .insert({ ...payload, created_by: auth.user?.id ?? null });
      if (error) {
        if (error.code === "23505") {
          throw new Error("Já existe um indicador com esse nome e tipo neste projeto.");
        }
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["indicators", "project", projectId] });
      toast.success(indicator ? "Indicador atualizado." : "Indicador criado.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validateIndicatorForm(form);
    if (!result.ok) {
      toast.error(Object.values(result.errors)[0] ?? "Formulário inválido.");
      return;
    }
    mutation.mutate(result);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{indicator ? "Editar indicador" : "Novo indicador"}</DialogTitle>
          <DialogDescription>
            Base, data da base e meta são opcionais, mas se preenchidas precisam ser válidas.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="indicator-name">Nome *</Label>
            <Input
              id="indicator-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Tipo *</Label>
            <Select
              value={form.kind}
              onValueChange={(v) => set("kind", v as IndicatorFormInput["kind"])}
            >
              <SelectTrigger>
                <SelectValue placeholder="Escolha o tipo" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="indicator-unit">Unidade</Label>
            <Input
              id="indicator-unit"
              placeholder="Ex.: R$, %, h, x"
              value={form.unit}
              onChange={(e) => set("unit", e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Direção *</Label>
            <Select
              value={form.direction}
              onValueChange={(v) => set("direction", v as IndicatorFormInput["direction"])}
            >
              <SelectTrigger>
                <SelectValue placeholder="Escolha a direção" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DIRECTION_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Frequência</Label>
            <Select
              value={form.frequency || "__none__"}
              onValueChange={(v) =>
                set("frequency", v === "__none__" ? "" : (v as IndicatorFormInput["frequency"]))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Sem frequência definida" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sem frequência definida</SelectItem>
                {Object.entries(FREQUENCY_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="indicator-baseline">Base</Label>
            <Input
              id="indicator-baseline"
              inputMode="decimal"
              placeholder="Ex.: 1.234,5"
              value={form.baselineValue}
              onChange={(e) => set("baselineValue", e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="indicator-baseline-at">Data da base</Label>
            <Input
              id="indicator-baseline-at"
              type="date"
              value={form.baselineAt}
              onChange={(e) => set("baselineAt", e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="indicator-target">Meta</Label>
            <Input
              id="indicator-target"
              inputMode="decimal"
              placeholder="Ex.: 2.000"
              value={form.targetValue}
              onChange={(e) => set("targetValue", e.target.value)}
            />
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar indicador"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
