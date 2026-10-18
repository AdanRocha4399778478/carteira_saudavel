import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import {
  formatNumberForInput,
  validateIndicatorPointForm,
  type IndicatorPointFormInput,
} from "@/lib/indicator-form";
import type { IndicatorPointRow, IndicatorRow } from "@/lib/indicators-data";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const empty: IndicatorPointFormInput = {
  value: "",
  measuredAt: "",
  basis: "",
  note: "",
};

export function IndicatorPointDialog({
  open,
  onOpenChange,
  indicator,
  point,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  indicator: IndicatorRow;
  point?: IndicatorPointRow | null;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<IndicatorPointFormInput>(empty);

  useEffect(() => {
    if (!open) return;
    setForm(
      point
        ? {
            value: formatNumberForInput(point.value),
            measuredAt: point.measured_at,
            basis: point.basis,
            note: point.note ?? "",
          }
        : empty,
    );
  }, [open, point]);

  const set = <K extends keyof IndicatorPointFormInput>(
    key: K,
    value: IndicatorPointFormInput[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: async (value: ReturnType<typeof validateIndicatorPointForm>) => {
      if (!value.ok) return;
      const payload = {
        indicator_id: indicator.id,
        client_id: indicator.client_id,
        project_id: indicator.project_id,
        value: value.value.value,
        measured_at: value.value.measured_at,
        basis: value.value.basis,
        note: value.value.note,
      };
      if (point) {
        const { error } = await supabase
          .from("indicator_points")
          .update(payload)
          .eq("id", point.id);
        if (error) throw new Error(error.message);
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("indicator_points")
        .insert({ ...payload, source: "manual", created_by: auth.user?.id ?? null });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["indicators", "project", indicator.project_id],
      });
      toast.success(point ? "Ponto atualizado." : "Ponto registrado.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validateIndicatorPointForm(form);
    if (!result.ok) {
      toast.error(Object.values(result.errors)[0] ?? "Formulário inválido.");
      return;
    }
    mutation.mutate(result);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{point ? "Editar ponto" : "Novo ponto"}</DialogTitle>
          <DialogDescription>
            Indique se o ponto é medido ou estimado — não há marca pré-selecionada.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="indicator-point-value">Valor *</Label>
            <Input
              id="indicator-point-value"
              inputMode="decimal"
              placeholder="Ex.: 1.234,5"
              value={form.value}
              onChange={(e) => set("value", e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="indicator-point-date">Data *</Label>
            <Input
              id="indicator-point-date"
              type="date"
              value={form.measuredAt}
              onChange={(e) => set("measuredAt", e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Marca *</Label>
            <Select
              value={form.basis}
              onValueChange={(v) => set("basis", v as IndicatorPointFormInput["basis"])}
            >
              <SelectTrigger>
                <SelectValue placeholder="Escolha medido ou estimado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="medido">Medido</SelectItem>
                <SelectItem value="estimado">Estimado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="indicator-point-note">Nota</Label>
            <Textarea
              id="indicator-point-note"
              rows={2}
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar ponto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
