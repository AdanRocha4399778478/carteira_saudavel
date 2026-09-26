import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, Square, Clock3 } from "lucide-react";
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
import { useAccess } from "@/lib/auth/access";
import { ERP_MACRO_AREAS, ERP_TAXONOMY } from "@/lib/domain";
import {
  clientTimeEntriesQuery,
  formatCents,
  formatDuration,
  runningTimerQuery,
  startTimer,
  stopTimer,
} from "@/lib/time-tracking";

export function TimerWidget({ clientId, projectId }: { clientId: string; projectId?: string }) {
  const { access } = useAccess();
  const consultantId = access?.userId;
  const qc = useQueryClient();

  const running = useQuery(runningTimerQuery(consultantId));
  const history = useQuery(clientTimeEntriesQuery(clientId));

  const [area, setArea] = useState<string>("");
  const [subarea, setSubarea] = useState<string>("");
  const [note, setNote] = useState("");
  const [stopNote, setStopNote] = useState("");
  const [tick, setTick] = useState(0);

  // Atualiza a exibição do tempo decorrido a cada segundo enquanto há um cronômetro rodando.
  useEffect(() => {
    if (!running.data) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running.data]);

  const elapsedLabel = useMemo(() => {
    if (!running.data) return null;
    const startedAt = new Date(running.data.started_at).getTime();
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running.data, tick]);

  const startMutation = useMutation({
    mutationFn: () => {
      if (!consultantId) throw new Error("Usuário não identificado.");
      if (!area) throw new Error("Escolha a área antes de iniciar.");
      return startTimer({
        clientId,
        projectId: projectId ?? null,
        consultantId,
        erpArea: area,
        erpSubarea: subarea || null,
        description: note || null,
      });
    },
    onSuccess: () => {
      toast.success("Cronômetro iniciado.");
      setNote("");
      qc.invalidateQueries({ queryKey: ["time-entries"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível iniciar o cronômetro."),
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => stopTimer({ id, ...(stopNote ? { description: stopNote } : {}) }),
    onSuccess: (entry) => {
      toast.success(
        `Apontamento salvo: ${formatDuration(entry.duration_seconds ?? 0)} · ${formatCents(entry.amount_cents ?? 0)}`,
      );
      setStopNote("");
      qc.invalidateQueries({ queryKey: ["time-entries"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível parar o cronômetro."),
  });

  const runningEntry = running.data ?? null;
  const runningForAnotherClient = runningEntry && runningEntry.client_id !== clientId;
  const subareaOptions = area ? (ERP_TAXONOMY[area] ?? []) : [];

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Clock3 className="h-4 w-4" />
        Controle de horas
      </div>

      {runningEntry ? (
        <div className="space-y-2">
          {runningForAnotherClient && (
            <p className="text-xs text-amber-600">
              Este cronômetro foi iniciado para outro cliente. Pare-o antes de iniciar um novo aqui.
            </p>
          )}
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg tabular-nums">{elapsedLabel}</span>
            <span className="text-sm text-muted-foreground">
              {runningEntry.erp_area}
              {runningEntry.erp_subarea ? ` · ${runningEntry.erp_subarea}` : ""}
            </span>
          </div>
          <Input
            placeholder="Nota rápida (opcional)"
            value={stopNote}
            onChange={(e) => setStopNote(e.target.value)}
          />
          <Button
            variant="destructive"
            size="sm"
            disabled={stopMutation.isPending}
            onClick={() => stopMutation.mutate(runningEntry.id)}
          >
            <Square className="h-4 w-4 mr-1" /> Parar
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Área</Label>
              <Select
                value={area}
                onValueChange={(v) => {
                  setArea(v);
                  setSubarea("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {ERP_MACRO_AREAS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Subárea</Label>
              <Select value={subarea} onValueChange={setSubarea} disabled={!area}>
                <SelectTrigger>
                  <SelectValue placeholder={area ? "Selecione" : "Escolha a área primeiro"} />
                </SelectTrigger>
                <SelectContent>
                  {subareaOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Input placeholder="Nota rápida (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" disabled={startMutation.isPending || !area} onClick={() => startMutation.mutate()}>
            <Play className="h-4 w-4 mr-1" /> Iniciar
          </Button>
        </div>
      )}

      {history.data && history.data.length > 0 && (
        <div className="pt-2 border-t space-y-1">
          <p className="text-xs text-muted-foreground">Últimos apontamentos</p>
          {history.data.slice(0, 5).map((e) => (
            <div key={e.id} className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {e.erp_area}
                {e.erp_subarea ? ` · ${e.erp_subarea}` : ""}
              </span>
              <span className="tabular-nums">
                {e.duration_seconds != null ? formatDuration(e.duration_seconds) : "em andamento"}
                {e.amount_cents != null ? ` · ${formatCents(e.amount_cents)}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
