import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { clientKnownNamesQuery } from "@/lib/api";
import { createClientPerson } from "@/lib/client-people-data";
import {
  resolvePerson,
  suggestPeopleFromHistory,
  type ClientPerson,
  type PersonHistoryRow,
  type PersonSide,
  type PersonSuggestion,
} from "@/lib/client-people";
import type { ActionItem } from "@/lib/domain";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/painel/states";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SIDE_LABEL: Record<PersonSide, string> = {
  cliente: "Cliente",
  consultoria: "Consultoria",
  terceiro: "Terceiro",
};

const ORIGIN_LABEL: Record<string, string> = {
  "responsável de ação": "ações",
  "responsável de decisão": "decisões",
  "participante de reunião": "reuniões",
};

/**
 * "Importar do histórico" — sugestões a partir de owner_name de ações (já
 * carregadas pela página do cliente), participants de reuniões e owner de
 * decisões (as duas últimas via clientKnownNamesQuery, já existente em
 * src/lib/api.ts — nenhuma consulta nova ao banco). Quem já está cadastrado
 * (por nome ou apelido, via resolvePerson) não aparece na lista.
 */
export function PeopleImportDialog({
  open,
  onOpenChange,
  clientId,
  people,
  actions,
  consultancyNames,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  people: ClientPerson[];
  actions: ActionItem[];
  consultancyNames: string[];
}) {
  const queryClient = useQueryClient();
  const knownNames = useQuery(clientKnownNamesQuery(clientId));
  const [selected, setSelected] = useState<
    Map<string, { checked: boolean; side: PersonSide | "" }>
  >(new Map());
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    if (!open) return [];
    const rows: PersonHistoryRow[] = [
      ...actions
        .filter((a) => a.owner_name && a.owner_name.trim())
        .map((a) => ({ name: a.owner_name as string, origin: "responsável de ação" as const })),
      ...(knownNames.data?.participants ?? [])
        .filter((n) => n && n.trim())
        .map((n) => ({ name: n, origin: "participante de reunião" as const })),
      ...(knownNames.data?.decisionOwners ?? [])
        .filter((n) => n && n.trim())
        .map((n) => ({ name: n, origin: "responsável de decisão" as const })),
    ];
    const all = suggestPeopleFromHistory(rows, consultancyNames);
    return all.filter((s) => !resolvePerson(s.name, people).person);
  }, [open, actions, knownNames.data, consultancyNames, people]);

  /**
   * Lado inicial de cada linha: "consultoria" SÓ quando suggestPeopleFromHistory
   * já sugeriu assim (nome bate com a lista de consultoria); vazio em
   * qualquer outro caso — a tela sempre pergunta, nunca pré-seleciona.
   */
  function defaultSideFor(s: PersonSuggestion): PersonSide | "" {
    return s.suggestedSide === "consultoria" ? "consultoria" : "";
  }

  function rowState(s: PersonSuggestion) {
    return selected.get(s.normalized) ?? { checked: false, side: defaultSideFor(s) };
  }

  function setRow(
    s: PersonSuggestion,
    patch: Partial<{ checked: boolean; side: PersonSide | "" }>,
  ) {
    setSelected((prev) => {
      const next = new Map(prev);
      next.set(s.normalized, { ...rowState(s), ...patch });
      return next;
    });
  }

  const checkedRows = suggestions.filter((s) => rowState(s).checked);
  const canImport = checkedRows.length > 0 && checkedRows.every((s) => rowState(s).side);

  async function importSelected() {
    setImporting(true);
    setReport(null);
    let ok = 0;
    const failures: string[] = [];
    for (const s of checkedRows) {
      const side = rowState(s).side;
      if (!side) continue;
      try {
        await createClientPerson({
          client_id: clientId,
          name: s.name,
          aliases: [],
          side,
          role: null,
          functions: [],
        });
        ok += 1;
      } catch (e) {
        failures.push(`${s.name}: ${e instanceof Error ? e.message : "erro desconhecido"}`);
      }
    }
    setImporting(false);
    void queryClient.invalidateQueries({ queryKey: ["client-people", "client", clientId] });
    setSelected(new Map());
    const summary =
      failures.length === 0
        ? `${ok} pessoa(s) cadastrada(s).`
        : `${ok} pessoa(s) cadastrada(s), ${failures.length} falha(s): ${failures.join("; ")}`;
    setReport(summary);
    if (failures.length === 0) {
      toast.success(summary);
      onOpenChange(false);
    } else {
      toast.error(summary);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar do histórico</DialogTitle>
          <DialogDescription>
            Nomes já vistos em ações, decisões e reuniões deste cliente, agrupados só por grafia
            idêntica (depois de normalizada) — nada aqui é criado sem você marcar e confirmar.
          </DialogDescription>
        </DialogHeader>

        {suggestions.length === 0 ? (
          <EmptyState
            title="Nenhuma sugestão nova"
            description="Todo nome do histórico já está cadastrado, ou não há histórico suficiente."
          />
        ) : (
          <div className="grid gap-2">
            {suggestions.map((s) => {
              const row = rowState(s);
              const origins = s.origins
                .map((o) => `${o.count} ${ORIGIN_LABEL[o.origin] ?? o.origin}`)
                .join(", ");
              return (
                <div
                  key={s.normalized}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-muted/40 px-3 py-2"
                >
                  <Checkbox
                    checked={row.checked}
                    onCheckedChange={(v) => setRow(s, { checked: v === true })}
                    aria-label={`Selecionar ${s.name}`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.count}× no histórico ({origins})
                    </p>
                  </div>
                  <Select
                    value={row.side}
                    onValueChange={(v) => setRow(s, { side: v as PersonSide })}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="Lado" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(SIDE_LABEL) as [PersonSide, string][]).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        )}

        {report ? <p className="text-sm text-muted-foreground">{report}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button
            type="button"
            disabled={!canImport || importing}
            onClick={() => void importSelected()}
          >
            {importing ? "Importando…" : `Adicionar selecionadas (${checkedRows.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
