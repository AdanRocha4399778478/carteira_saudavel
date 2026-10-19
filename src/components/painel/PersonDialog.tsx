import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  createClientPerson,
  deleteClientPerson,
  updateClientPerson,
} from "@/lib/client-people-data";
import {
  groupPersonErrors,
  normalizeAliasList,
  splitAliasInput,
  validatePersonForm,
  type PersonFormInput,
} from "@/lib/client-people-form";
import {
  PERSON_FUNCTIONS,
  type ClientPerson,
  type PersonFunction,
  type PersonSide,
} from "@/lib/client-people";
import { useAccess } from "@/lib/auth/access";
import { ConfirmDeleteDialog } from "@/components/painel/ConfirmDeleteDialog";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const FUNCTION_LABEL: Record<PersonFunction, string> = {
  executa: "Executa",
  monitora: "Monitora",
  acompanha: "Acompanha",
  decide: "Decide",
};

const SIDE_LABEL: Record<PersonSide, string> = {
  cliente: "Cliente",
  consultoria: "Consultoria",
  terceiro: "Terceiro",
};

const empty: PersonFormInput = {
  name: "",
  aliases: [],
  side: "",
  role: "",
  functions: [],
};

export function PersonDialog({
  open,
  onOpenChange,
  clientId,
  person,
  people,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  person?: ClientPerson | null;
  /** Demais pessoas do cliente — usadas só pra checar colisão de nome/apelido. */
  people: ClientPerson[];
}) {
  const queryClient = useQueryClient();
  const { isAdmin } = useAccess();
  const [form, setForm] = useState<PersonFormInput>(empty);
  const [active, setActive] = useState(true);
  const [aliasDraft, setAliasDraft] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors([]);
    setAliasDraft("");
    setForm(
      person
        ? {
            name: person.name,
            aliases: [...person.aliases],
            side: person.side,
            role: person.role ?? "",
            functions: [...person.functions],
          }
        : empty,
    );
    setActive(person ? person.active : true);
  }, [open, person]);

  const set = <K extends keyof PersonFormInput>(key: K, value: PersonFormInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const fieldErrors = groupPersonErrors(errors);

  function addAliasFromDraft() {
    const pieces = splitAliasInput(aliasDraft);
    if (pieces.length === 0) return;
    set("aliases", [...form.aliases, ...pieces]);
    setAliasDraft("");
  }

  function toggleFunction(fn: PersonFunction, checked: boolean) {
    set("functions", checked ? [...form.functions, fn] : form.functions.filter((f) => f !== fn));
  }

  const mutation = useMutation({
    mutationFn: async (finalAliases: string[]) => {
      if (person) {
        return updateClientPerson(person.id, {
          name: form.name.trim(),
          aliases: finalAliases,
          side: form.side as ClientPerson["side"],
          role: form.role.trim() || null,
          functions: form.functions as PersonFunction[],
          active,
        });
      }
      return createClientPerson({
        client_id: clientId,
        name: form.name.trim(),
        aliases: finalAliases,
        side: form.side as ClientPerson["side"],
        role: form.role.trim() || null,
        functions: form.functions as PersonFunction[],
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["client-people", "client", clientId] });
      toast.success(person ? "Pessoa atualizada." : "Pessoa cadastrada.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!person) return;
      await deleteClientPerson(person.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["client-people", "client", clientId] });
      toast.success("Pessoa excluída.");
      setDeleteOpen(false);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Apelido digitado mas não confirmado com Enter/vírgula não pode se
    // perder — entra na validação e na gravação igual aos já confirmados.
    const draftPieces = splitAliasInput(aliasDraft);
    const finalAliases = normalizeAliasList([...form.aliases, ...draftPieces]);
    const found = validatePersonForm(
      { ...form, aliases: finalAliases },
      people,
      person?.id ?? null,
    );
    setErrors(found);
    if (found.length > 0) return;
    mutation.mutate(finalAliases);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{person ? "Editar pessoa" : "Nova pessoa"}</DialogTitle>
            <DialogDescription>
              Pessoas e apelidos deste cliente — usado para reconhecer quem é quem nas reuniões.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="person-name">Nome *</Label>
              <Input
                id="person-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
              {fieldErrors.name.map((msg) => (
                <p key={msg} className="text-xs text-destructive">
                  {msg}
                </p>
              ))}
            </div>

            <div className="grid gap-1.5">
              <Label>Lado *</Label>
              <Select
                value={form.side}
                onValueChange={(v) => set("side", v as PersonFormInput["side"])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(SIDE_LABEL) as [PersonSide, string][]).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.side.map((msg) => (
                <p key={msg} className="text-xs text-destructive">
                  {msg}
                </p>
              ))}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="person-role">Cargo</Label>
              <Input
                id="person-role"
                value={form.role}
                onChange={(e) => set("role", e.target.value)}
                placeholder="Opcional"
              />
            </div>

            <div className="grid gap-1.5">
              <Label>Funções</Label>
              <div className="flex flex-wrap gap-4">
                {PERSON_FUNCTIONS.map((fn) => (
                  <div key={fn} className="flex items-center gap-2">
                    <Checkbox
                      id={`function-${fn}`}
                      checked={form.functions.includes(fn)}
                      onCheckedChange={(v) => toggleFunction(fn, v === true)}
                    />
                    <Label htmlFor={`function-${fn}`} className="cursor-pointer font-normal">
                      {FUNCTION_LABEL[fn]}
                    </Label>
                  </div>
                ))}
              </div>
              {fieldErrors.functions.map((msg) => (
                <p key={msg} className="text-xs text-destructive">
                  {msg}
                </p>
              ))}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="person-alias">Apelidos</Label>
              <div className="flex flex-wrap gap-1.5">
                {form.aliases.map((alias, index) => (
                  <Badge key={`${alias}-${index}`} variant="secondary" className="gap-1">
                    {alias}
                    <button
                      type="button"
                      aria-label={`Remover apelido ${alias}`}
                      className="ml-1 opacity-70 hover:opacity-100"
                      onClick={() =>
                        set(
                          "aliases",
                          form.aliases.filter((_, i) => i !== index),
                        )
                      }
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
              <Input
                id="person-alias"
                value={aliasDraft}
                placeholder="Digite e pressione Enter ou vírgula (cole vários separados por , ou ;)"
                onChange={(e) => {
                  const value = e.target.value;
                  if (/[,;]/.test(value)) {
                    const parts = value.split(/[,;]/);
                    const last = parts.pop() ?? "";
                    const completed = parts.map((p) => p.trim()).filter(Boolean);
                    if (completed.length > 0) {
                      set("aliases", [...form.aliases, ...completed]);
                    }
                    setAliasDraft(last.replace(/^\s+/, ""));
                    return;
                  }
                  setAliasDraft(value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAliasFromDraft();
                  }
                }}
              />
              {fieldErrors.aliases.map((msg) => (
                <p key={msg} className="text-xs text-destructive">
                  {msg}
                </p>
              ))}
            </div>

            {person ? (
              <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                <div>
                  <Label htmlFor="person-active">Ativa</Label>
                  <p className="text-xs text-muted-foreground">
                    Pessoa inativa some das sugestões, mas o histórico dela é mantido
                  </p>
                </div>
                <Switch id="person-active" checked={active} onCheckedChange={setActive} />
              </div>
            ) : null}

            {fieldErrors.general.map((msg) => (
              <p key={msg} className="text-xs text-destructive">
                {msg}
              </p>
            ))}

            <DialogFooter className="items-center sm:justify-between">
              {person && isAdmin ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Excluir
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? "Salvando…" : "Salvar"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {person && isAdmin ? (
        <ConfirmDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Excluir pessoa"
          description={`Excluir "${person.name}" do cadastro de pessoas deste cliente? Essa ação não pode ser desfeita.`}
          onConfirm={() => deleteMutation.mutate()}
          pending={deleteMutation.isPending}
        />
      ) : null}
    </>
  );
}
