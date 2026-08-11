import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { ACCOUNT_STATUSES, quadrantOf, type Client, type Profile } from "@/lib/domain";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type FormState = {
  company_name: string;
  segment: string;
  consultant_id: string;
  start_date: string;
  account_status: string;
  next_meeting_date: string;
  notes: string;
  active: boolean;
};

const empty: FormState = {
  company_name: "",
  segment: "",
  consultant_id: "",
  start_date: "",
  account_status: "saudável",
  next_meeting_date: "",
  notes: "",
  active: true,
};

export function ClientDialog({
  open,
  onOpenChange,
  client,
  consultants,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client?: Client | null;
  consultants: Profile[];
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(empty);

  useEffect(() => {
    if (!open) return;
    setForm(
      client
        ? {
            company_name: client.company_name,
            segment: client.segment ?? "",
            consultant_id: client.consultant_id ?? "",
            start_date: client.start_date ?? "",
            account_status: client.account_status,
            next_meeting_date: client.next_meeting_date ?? "",
            notes: client.notes ?? "",
            active: client.active,
          }
        : empty,
    );
  }, [open, client]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        company_name: form.company_name.trim(),
        segment: form.segment.trim() || null,
        consultant_id: form.consultant_id || null,
        start_date: form.start_date || null,
        account_status: form.account_status,
        next_meeting_date: form.next_meeting_date || null,
        notes: form.notes.trim() || null,
        active: form.active,
      };
      if (client) {
        const { error } = await supabase.from("clients").update(payload).eq("id", client.id);
        if (error) throw new Error(error.message);
        return client.id;
      }
      const { data, error } = await supabase
        .from("clients")
        .insert({ ...payload, current_quadrant: quadrantOf(null, null) })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id as string;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success(client ? "Cliente atualizado com sucesso." : "Cliente cadastrado com sucesso.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.company_name.trim()) {
      toast.error("Informe o nome da empresa.");
      return;
    }
    if (!form.consultant_id) {
      toast.error("Selecione o consultor responsável.");
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{client ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          <DialogDescription>
            Dados cadastrais da conta de consultoria. Os indicadores são atualizados pelas reuniões.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="company">Nome da empresa *</Label>
            <Input
              id="company"
              value={form.company_name}
              onChange={(e) => set("company_name", e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="segment">Segmento</Label>
            <Input
              id="segment"
              value={form.segment}
              onChange={(e) => set("segment", e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Consultor responsável *</Label>
            <Select value={form.consultant_id} onValueChange={(v) => set("consultant_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {consultants.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="start">Início do projeto</Label>
            <Input
              id="start"
              type="date"
              value={form.start_date}
              onChange={(e) => set("start_date", e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Status da conta</Label>
            <Select value={form.account_status} onValueChange={(v) => set("account_status", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="next">Próxima reunião</Label>
            <Input
              id="next"
              type="date"
              value={form.next_meeting_date}
              onChange={(e) => set("next_meeting_date", e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
            <div>
              <Label htmlFor="active">Conta ativa</Label>
              <p className="text-xs text-muted-foreground">Desligue para encerrar o projeto</p>
            </div>
            <Switch
              id="active"
              checked={form.active}
              onCheckedChange={(v) => set("active", v)}
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="notes">Observações</Label>
            <Textarea
              id="notes"
              rows={3}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar cliente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
