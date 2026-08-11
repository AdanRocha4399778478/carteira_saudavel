import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Client, Profile } from "@/lib/domain";
import {
  ensureProjectContext,
  getOrCreateProject,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  type Project,
} from "@/lib/projects";
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

type FormState = {
  client_id: string;
  name: string;
  description: string;
  status: string;
  start_date: string;
  target_end_date: string;
  consultant_id: string;
};

const empty: FormState = {
  client_id: "",
  name: "",
  description: "",
  status: "planejamento",
  start_date: "",
  target_end_date: "",
  consultant_id: "",
};

export function ProjectDialog({
  open,
  onOpenChange,
  project,
  clients,
  consultants,
  defaultClientId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project?: Project | null;
  clients: Client[];
  consultants: Profile[];
  defaultClientId?: string;
  onCreated?: (projectId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(empty);

  useEffect(() => {
    if (!open) return;
    setForm(
      project
        ? {
            client_id: project.client_id,
            name: project.name,
            description: project.description ?? "",
            status: project.status,
            start_date: project.start_date ?? "",
            target_end_date: project.target_end_date ?? "",
            consultant_id: project.consultant_id ?? "",
          }
        : {
            ...empty,
            client_id: defaultClientId ?? "",
            consultant_id:
              clients.find((c) => c.id === defaultClientId)?.consultant_id ?? "",
          },
    );
  }, [open, project, defaultClientId, clients]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        client_id: form.client_id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        status: form.status,
        start_date: form.start_date || null,
        target_end_date: form.target_end_date || null,
        consultant_id: form.consultant_id || null,
      };
      if (project) {
        const { error } = await supabase.from("projects").update(payload).eq("id", project.id);
        if (error) throw new Error(error.message);
        return project.id;
      }
      // Criação idempotente: o banco reaproveita projeto equivalente do cliente
      // em vez de gerar uma duplicata.
      const created = await getOrCreateProject({
        clientId: payload.client_id,
        name: payload.name,
        description: payload.description,
      });
      if (created.reused) toast.info("Já existia um projeto equivalente — ele foi reaproveitado.");
      const id = created.project.id;
      const rest = {
        status: payload.status,
        start_date: payload.start_date,
        target_end_date: payload.target_end_date,
        consultant_id: payload.consultant_id,
      };
      const { error } = await supabase.from("projects").update(rest).eq("id", id);
      if (error) throw new Error(error.message);
      await ensureProjectContext(id);
      return id;

    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(project ? "Projeto atualizado." : "Projeto criado.");
      onOpenChange(false);
      if (!project) onCreated?.(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.client_id) {
      toast.error("Selecione o cliente.");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Informe o nome do projeto.");
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{project ? "Editar projeto" : "Novo projeto consultivo"}</DialogTitle>
          <DialogDescription>
            Um cliente pode ter vários projetos. O contexto e as reuniões ficam vinculados ao
            projeto.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Cliente *</Label>
            <Select
              value={form.client_id}
              onValueChange={(v) => set("client_id", v)}
              disabled={!!project}
            >
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

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="project-name">Nome do projeto *</Label>
            <Input
              id="project-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Ex.: Reestruturação comercial 2026"
            />
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="project-desc">Descrição</Label>
            <Textarea
              id="project-desc"
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {PROJECT_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Consultor responsável</Label>
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

          <div className="grid gap-1.5">
            <Label htmlFor="project-start">Data de início</Label>
            <Input
              id="project-start"
              type="date"
              value={form.start_date}
              onChange={(e) => set("start_date", e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="project-end">Previsão de término</Label>
            <Input
              id="project-end"
              type="date"
              value={form.target_end_date}
              onChange={(e) => set("target_end_date", e.target.value)}
            />
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar projeto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
