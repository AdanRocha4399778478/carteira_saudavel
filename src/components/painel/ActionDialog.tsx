import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { recalculateClient } from "@/lib/api";
import {
  ACTION_STATUSES,
  ERP_AREAS,
  PRIORITIES,
  type ActionItem,
  type Client,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Form = {
  client_id: string;
  description: string;
  owner_name: string;
  deadline: string;
  priority: string;
  status: string;
  erp_area: string;
  evidence: string;
};

const empty: Form = {
  client_id: "",
  description: "",
  owner_name: "",
  deadline: "",
  priority: "média",
  status: "não iniciada",
  erp_area: "",
  evidence: "",
};

export function ActionDialog({
  open,
  onOpenChange,
  action,
  clients,
  riskRules,
  defaultClientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  action?: ActionItem | null;
  clients: Client[];
  riskRules: RiskRule[];
  defaultClientId?: string;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(empty);

  useEffect(() => {
    if (!open) return;
    setForm(
      action
        ? {
            client_id: action.client_id,
            description: action.description,
            owner_name: action.owner_name ?? "",
            deadline: action.deadline ?? "",
            priority: action.priority,
            status: action.status,
            erp_area: action.erp_area ?? "",
            evidence: action.evidence ?? "",
          }
        : { ...empty, client_id: defaultClientId ?? "" },
    );
  }, [open, action, defaultClientId]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        client_id: form.client_id,
        description: form.description.trim(),
        owner_name: form.owner_name.trim() || null,
        deadline: form.deadline || null,
        priority: form.priority,
        status: form.status,
        erp_area: form.erp_area || null,
        evidence: form.evidence.trim() || null,
      };
      if (action) {
        const { error } = await supabase.from("actions").update(payload).eq("id", action.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("actions").insert(payload);
        if (error) throw new Error(error.message);
      }
      await recalculateClient(form.client_id, riskRules);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["actions"] });
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success(action ? "Ação atualizada." : "Ação criada.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.client_id) {
      toast.error("Selecione o cliente.");
      return;
    }
    if (!form.description.trim()) {
      toast.error("Descreva a ação.");
      return;
    }
    mutation.mutate();
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{action ? "Editar ação" : "Nova ação"}</DialogTitle>
          <DialogDescription>
            Ações vencidas aumentam o risco de cancelamento da conta automaticamente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
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
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="desc">Descrição *</Label>
            <Textarea
              id="desc"
              rows={2}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="owner">Responsável</Label>
            <Input
              id="owner"
              value={form.owner_name}
              onChange={(e) => set("owner_name", e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dl">Prazo</Label>
            <Input
              id="dl"
              type="date"
              value={form.deadline}
              onChange={(e) => set("deadline", e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Prioridade</Label>
            <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Área do ERP</Label>
            <Select value={form.erp_area} onValueChange={(v) => set("erp_area", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
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
            <Label htmlFor="evidence">Evidência</Label>
            <Input
              id="evidence"
              value={form.evidence}
              onChange={(e) => set("evidence", e.target.value)}
            />
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar ação"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
