import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { formatDate, type Meeting } from "@/lib/domain";
import { DECISION_STATUSES, DECISION_STATUS_LABEL, type Decision } from "@/lib/projects";
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

const NONE = "__none__";

type FormState = {
  title: string;
  description: string;
  reason: string;
  status: string;
  owner: string;
  due_date: string;
  meeting_id: string;
};

const empty: FormState = {
  title: "",
  description: "",
  reason: "",
  status: "pendente",
  owner: "",
  due_date: "",
  meeting_id: NONE,
};

export function DecisionDialog({
  open,
  onOpenChange,
  projectId,
  clientId,
  meetings,
  decision,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  clientId: string;
  meetings: Meeting[];
  decision?: Decision | null;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(empty);

  useEffect(() => {
    if (!open) return;
    setForm(
      decision
        ? {
            title: decision.title,
            description: decision.description ?? "",
            reason: decision.reason ?? "",
            status: decision.status,
            owner: decision.owner ?? "",
            due_date: decision.due_date ?? "",
            meeting_id: decision.meeting_id ?? NONE,
          }
        : empty,
    );
  }, [open, decision]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        project_id: projectId,
        client_id: clientId,
        meeting_id: form.meeting_id === NONE ? null : form.meeting_id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        reason: form.reason.trim() || null,
        status: form.status,
        owner: form.owner.trim() || null,
        due_date: form.due_date || null,
      };
      if (decision) {
        const { error } = await supabase.from("decisions").update(payload).eq("id", decision.id);
        if (error) throw new Error(error.message);
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("decisions")
        .insert({ ...payload, created_by: auth.user?.id ?? null });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["decisions"] });
      toast.success(decision ? "Decisão atualizada." : "Decisão registrada.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error("Informe o título da decisão.");
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{decision ? "Editar decisão" : "Nova decisão"}</DialogTitle>
          <DialogDescription>
            Decisões podem ser vinculadas à reunião em que surgiram, sem alterar o histórico.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="decision-title">Título *</Label>
            <Input
              id="decision-title"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="decision-desc">Descrição</Label>
            <Textarea
              id="decision-desc"
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="decision-reason">Motivo / justificativa</Label>
            <Textarea
              id="decision-reason"
              rows={2}
              value={form.reason}
              onChange={(e) => set("reason", e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DECISION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {DECISION_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="decision-owner">Responsável</Label>
            <Input
              id="decision-owner"
              value={form.owner}
              onChange={(e) => set("owner", e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="decision-due">Prazo</Label>
            <Input
              id="decision-due"
              type="date"
              value={form.due_date}
              onChange={(e) => set("due_date", e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Reunião de origem</Label>
            <Select value={form.meeting_id} onValueChange={(v) => set("meeting_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Nenhuma" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nenhuma</SelectItem>
                {meetings.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {formatDate(m.meeting_date)} — {m.meeting_type ?? "Reunião"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar decisão"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
