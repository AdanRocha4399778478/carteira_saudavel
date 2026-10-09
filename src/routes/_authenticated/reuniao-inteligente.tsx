import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, FileText, Loader2, Sparkles, Upload, X } from "lucide-react";
import { PageHeader } from "@/components/painel/PageHeader";
import { ErrorState } from "@/components/painel/states";
import { ClientCombobox } from "@/components/painel/ClientCombobox";
import { ErpAreaSubareaSelect } from "@/components/painel/ErpAreaSubareaSelect";
import { MeetingAnalysisDialog } from "@/components/painel/MeetingAnalysisDialog";
import { routeErrorComponent } from "@/components/painel/RouteError";
import { supabase } from "@/lib/supabase/client";
import {
  actionsQuery,
  clientMeetingsQuery,
  clientsQuery,
  logDbError,
  opportunitiesQuery,
  risksQuery,
} from "@/lib/api";
import { MEETING_TYPES, normalizeMeeting, type Meeting } from "@/lib/domain";
import { cleanParticipants, normalizeMeetingType } from "@/lib/identification-clean";
import { useAccess } from "@/lib/auth/access";
import {
  classifyProjectMatch,
  clientDecisionsQuery,
  decisionsQuery,
  ensureProjectContext,
  getOrCreateProjectErp,
  projectsQuery,
  type Project,
  type ProjectContext,
} from "@/lib/projects";
import { buildProjectName, isValidErpPair } from "@/lib/project-name";
import { isValidErpTriple } from "@/lib/erp-hierarchy";
import { normalizeProjectProposal } from "@/lib/project-proposal";

import { parseAnalysis, type MeetingAnalysis } from "@/lib/meeting-analysis";
import { transcriptHash, transcriptKey } from "@/lib/transcript-fingerprint";
import { analyzeMeetingWithAI } from "@/lib/intelligent-meeting.functions";
import {
  extractTranscriptFromPdf,
  formatBytes,
  manualSource,
  MIN_TRANSCRIPT_CHARS,
  normalizeTranscript,
  PDF_MAX_BYTES,
  pdfSource,
  sourceLabel,
  TranscriptExtractionError,
  validatePdfFile,
  type ExtractedTranscript,
  type TranscriptSource,
} from "@/lib/transcript-source";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/reuniao-inteligente")({
  head: () => ({
    meta: [
      { title: "Reunião Inteligente | Resultados S/A" },
      {
        name: "description",
        content:
          "Grave ou envie a reunião, gere a análise estruturada, identifique cliente e projeto e aprove as atualizações.",
      },
      { property: "og:title", content: "Reunião Inteligente | Resultados S/A" },
      {
        property: "og:description",
        content: "Da gravação à atualização do projeto, com aprovação do consultor.",
      },
    ],
  }),
  // Atalhos contextuais chegam com cliente/projeto já definidos.
  validateSearch: (search: Record<string, unknown>): { clientId?: string; projectId?: string } => ({
    ...(typeof search["clientId"] === "string" && search["clientId"]
      ? { clientId: search["clientId"] }
      : {}),
    ...(typeof search["projectId"] === "string" && search["projectId"]
      ? { projectId: search["projectId"] }
      : {}),
  }),
  component: SmartMeetingPage,
  errorComponent: routeErrorComponent("Reunião Inteligente"),
});

type Step = "captura" | "transcricao" | "identificacao";

type Identification = {
  client_id: string | null;
  client_name: string;
  project_id: string | null;
  project_name: string;
  project_proposal: { description: string; erp_area: string | null; erp_subarea: string | null };
  meeting_date: string;
  meeting_type: string;
  participants: string[];
  reasoning: string;
  client_confidence: number;
  project_confidence: number;
  project_status: "existing_project" | "new_project" | "uncertain";
};

function normalizeIdentification(raw: unknown): Identification {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const cid = str(o["client_id"]);
  const pid = str(o["project_id"]);
  const parts = o["participants"];
  return {
    client_id: cid || null,
    client_name: str(o["client_name"]),
    project_id: pid || null,
    project_name: str(o["project_name"]),
    project_proposal: normalizeProjectProposal(o["project_proposal"]),
    meeting_date: str(o["meeting_date"]),
    meeting_type: str(o["meeting_type"]),
    participants: Array.isArray(parts) ? parts.map((p) => String(p)) : [],
    reasoning: str(o["reasoning"]),
    client_confidence: Number(o["client_confidence"] ?? 0),
    project_confidence: Number(o["project_confidence"] ?? 0),
    project_status:
      str(o["project_status"]) === "existing_project"
        ? "existing_project"
        : str(o["project_status"]) === "new_project"
          ? "new_project"
          : pid
            ? "existing_project"
            : "uncertain",
  };
}

function StepBadge({ index, label, active, done }: { index: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
          done || active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}
      >
        {done ? <CheckCircle2 className="size-3.5" aria-hidden /> : index}
      </span>
      <span className={active ? "text-sm font-semibold" : "text-sm text-muted-foreground"}>{label}</span>
    </div>
  );
}

function SmartMeetingPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const preset = Route.useSearch();
  const fileRef = useRef<HTMLInputElement>(null);

  const clients = useQuery(clientsQuery());
  const projects = useQuery(projectsQuery());
  const actions = useQuery(actionsQuery());
  const risks = useQuery(risksQuery());
  const opportunities = useQuery(opportunitiesQuery());
  const { access } = useAccess();

  const analyze = useServerFn(analyzeMeetingWithAI);

  const [step, setStep] = useState<Step>("captura");
  const [transcript, setTranscript] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<ExtractedTranscript | null>(null);
  const [source, setSource] = useState<TranscriptSource | null>(null);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [analysis, setAnalysis] = useState<MeetingAnalysis | null>(null);
  const [rawAiResponse, setRawAiResponse] = useState<string | null>(null);
  const [ident, setIdent] = useState<Identification | null>(null);
  const [clientId, setClientId] = useState(preset.clientId ?? "");
  const [projectId, setProjectId] = useState(preset.projectId ?? "");
  const [newProjectArea, setNewProjectArea] = useState("");
  const [newProjectSubarea, setNewProjectSubarea] = useState("");
  const [newProjectItem, setNewProjectItem] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [confirmSimilar, setConfirmSimilar] = useState(false);
  const newProjectName = isValidErpPair(newProjectArea, newProjectSubarea)
    ? buildProjectName(newProjectArea, newProjectSubarea, newProjectItem)
    : "";

  const [meetingDate, setMeetingDate] = useState("");
  const [meetingType, setMeetingType] = useState<string>("");
  const [participants, setParticipants] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [context, setContext] = useState<ProjectContext | null>(null);
  /**
   * Dados para gravar a reunião de verdade — só usados dentro de
   * `persistDraftMeeting`, chamada pelo diálogo no momento da aprovação.
   * Enquanto isso, `meeting` acima é só um rascunho em memória (`id: ""`).
   */
  const [draftInfo, setDraftInfo] = useState<{
    clientId: string;
    projectId: string;
    meetingDate: string;
    meetingType: string;
    participants: string[];
    transcriptHash: string;
    transcriptKey: string;
  } | null>(null);

  const decisions = useQuery({ ...decisionsQuery(project?.id), enabled: !!project?.id });
  /** Universo completo do cliente pra checagem antiduplicidade — não só o projeto identificado. */
  const allClientDecisions = useQuery({
    ...clientDecisionsQuery(meeting?.client_id ?? ""),
    enabled: !!meeting?.client_id,
  });
  const clientMeetings = useQuery({
    ...clientMeetingsQuery(meeting?.client_id ?? ""),
    enabled: !!meeting?.client_id,
  });

  /**
   * Impressão digital da transcrição: permite avisar sobre reenvio do mesmo
   * conteúdo ANTES de gravar, sem bloquear reprocessamentos legítimos.
   */
  const [hash, setHash] = useState("");
  useEffect(() => {
    if (step !== "identificacao" || transcript.trim().length === 0) {
      setHash("");
      return;
    }
    let alive = true;
    void transcriptHash(transcript).then((h) => {
      if (alive) setHash(h);
    });
    return () => {
      alive = false;
    };
  }, [step, transcript]);

  const alreadyProcessed = useQuery({
    queryKey: ["meetings", "hash", hash, clientId, projectId],
    enabled: !!hash && !!clientId,
    queryFn: async () => {
      let q = supabase
        .from("meetings")
        .select("*")
        .eq("client_id", clientId)
        .eq("transcript_hash", hash)
        .order("created_at", { ascending: false })
        .limit(1);
      if (projectId) q = q.eq("project_id", projectId);
      const res = await q;
      if (res.error) {
        logDbError("meetings", "select-transcript-hash", res.error);
        return null;
      }
      const row = (res.data ?? [])[0];
      return row ? normalizeMeeting(row as Record<string, unknown>) : null;
    },
  });

  const clientProjects = useMemo(
    () => (projects.data ?? []).filter((p) => p.client_id === clientId),
    [projects.data, clientId],
  );

  /**
   * Etapa iniciada de dentro de um cliente/projeto: o sistema já sabe a origem
   * e não pede a informação de novo (o consultor ainda pode alterar).
   */
  const [overrideContext, setOverrideContext] = useState(false);
  const presetProject = useMemo(
    () => (projects.data ?? []).find((p) => p.id === projectId) ?? null,
    [projects.data, projectId],
  );
  const contextKnown = !!preset.clientId && clientId === preset.clientId;

  /**
   * Aviso antiduplicidade antes de propor um novo projeto. Nomes gerados por
   * área/subárea compartilham palavras entre áreas diferentes do mesmo cliente
   * (ex.: "Jurídica - Gestão de Contratos" e "Administrativo - Gestão de
   * Contratos") — o fuzzy (PROBABLE_MATCH) não deve alertar quando o par
   * área/subárea já é válido; só o reaproveitamento por nome EXATO continua
   * valendo (resolvido depois pela própria RPC idempotente).
   */
  const projectMatch = useMemo(() => {
    const match = classifyProjectMatch(newProjectName, clientProjects);
    if (match.kind === "PROBABLE_MATCH" && isValidErpPair(newProjectArea, newProjectSubarea)) {
      return {
        kind: "NEW_PROJECT" as const,
        existing: null,
        confidence: match.confidence,
        reason: "",
      };
    }
    return match;
  }, [newProjectName, newProjectArea, newProjectSubarea, clientProjects]);

  /* ---------------- 1. transcrição (PDF ou texto colado) ---------------- */

  const extractPdf = useMutation({
    mutationFn: async (file: File) => {
      validatePdfFile(file);
      return extractTranscriptFromPdf(file);
    },
    onSuccess: (result) => {
      setErrors([]);
      setExtracted(result);
      setTranscript(result.text);
      setSource(pdfSource(result, result.text));
      toast.success(`Texto extraído de ${result.pages} páginas.`);
    },
    onError: (e: Error) => {
      setExtracted(null);
      setErrors([
        e instanceof TranscriptExtractionError
          ? e.message
          : `Falha ao ler o PDF: ${e.message}`,
      ]);
    },
  });

  function handlePdf(file: File | undefined) {
    if (!file) return;
    setPdfFile(file);
    setShowFullTranscript(false);
    extractPdf.mutate(file);
  }

  function clearPdf() {
    setPdfFile(null);
    setExtracted(null);
    setSource(null);
    setTranscript("");
    setErrors([]);
    extractPdf.reset();
    if (fileRef.current) fileRef.current.value = "";
  }

  const pdfState: "aguardando" | "extraindo" | "pronto" | "erro" = extractPdf.isPending
    ? "extraindo"
    : extractPdf.isError
      ? "erro"
      : extracted
        ? "pronto"
        : "aguardando";

  /* ---------------- 2. análise + identificação ---------------- */

  const runAnalysis = useMutation({
    mutationFn: async () => {
      const raw = await analyze({
        data: {
          transcript: normalizeTranscript(transcript),
          source: source
            ? { type: source.type, file_name: source.file_name }
            : { type: "manual" as const, file_name: null },
          clients: (clients.data ?? []).map((c) => ({ id: c.id, name: c.company_name })),
          projects: (projects.data ?? []).map((p) => ({
            id: p.id,
            client_id: p.client_id,
            name: p.name,
            status: p.status,
          })),
          consultantName: access?.profile?.full_name ?? undefined,
        },
      });
      const payload = JSON.parse(raw.json) as Record<string, unknown>;
      const parsed = parseAnalysis(payload["analysis"]);
      if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
      return {
        analysis: parsed.analysis,
        identification: normalizeIdentification(payload["identification"]),
        rawAiResponse: raw.rawAnalysisJson ?? null,
      };
    },
    onSuccess: ({ analysis: a, identification, rawAiResponse: rawResp }) => {
      setErrors([]);
      setAnalysis(a);
      setIdent(identification);
      setRawAiResponse(rawResp);
      // Confiança insuficiente não seleciona automaticamente — o consultor decide.
      // Atalho contextual manda: cliente/projeto vindos da tela de origem prevalecem.
      setClientId(
        preset.clientId ??
          (identification.client_confidence >= 0.6 ? (identification.client_id ?? "") : ""),
      );
      setProjectId(
        preset.projectId ??
          (identification.project_confidence >= 0.6 ? (identification.project_id ?? "") : ""),
      );
      setNewProjectArea(identification.project_proposal.erp_area ?? "");
      setNewProjectSubarea(identification.project_proposal.erp_subarea ?? "");
      setNewProjectItem("");
      setNewProjectDesc(identification.project_proposal.description);
      setMeetingDate(
        /^\d{4}-\d{2}-\d{2}$/.test(identification.meeting_date)
          ? identification.meeting_date
          : new Date().toISOString().slice(0, 10),
      );
      setMeetingType(normalizeMeetingType(identification.meeting_type));
      setParticipants(cleanParticipants(identification.participants.join(", ")));
      setStep("identificacao");
    },
    onError: (e: Error) => setErrors(e.message.split("\n")),
  });

  /* ---------------- 3. vínculo + reunião ---------------- */

  /**
   * Monta o preview em memória — nada é gravado em `meetings` aqui. A
   * gravação de verdade só acontece em `persistDraftMeeting`, chamada pelo
   * diálogo no início da aprovação. Fechar o diálogo sem aprovar não deixa
   * nenhuma linha para trás (era a causa da reunião "capenga": preview
   * gravava a reunião de imediato, e satisfação/valor/próxima ação e as
   * decisões/ações ficavam vazias se a aprovação nunca era concluída).
   */
  const createAndReview = useMutation({
    mutationFn: async (force: boolean) => {
      if (!clientId) throw new Error("Selecione o cliente da reunião.");
      if (!meetingType) throw new Error("Escolha o tipo da reunião.");
      if (!analysis) throw new Error("Nenhuma análise disponível.");

      let target = clientProjects.find((p) => p.id === projectId) ?? null;
      if (!target) {
        if (!isValidErpTriple(newProjectArea, newProjectSubarea, newProjectItem)) {
          throw new Error("Escolha a área e a subárea do ERP do novo projeto.");
        }
        const name = buildProjectName(newProjectArea, newProjectSubarea, newProjectItem);
        const created = await getOrCreateProjectErp({
          clientId,
          name,
          erpArea: newProjectArea,
          erpSubarea: newProjectSubarea,
          erpItem: newProjectItem || null,
          description: newProjectDesc.trim() || null,
        });
        if (created.reused) {
          toast.info(`Usando o projeto existente "${created.project.name}".`);
        }
        target = created.project;
        void qc.invalidateQueries({ queryKey: ["projects"] });
      }

      /**
       * A gravação da reunião é idempotente: a mesma transcrição, para o mesmo
       * cliente, reaproveita a reunião já criada em vez de duplicar. Só um
       * "processar mesmo assim" explícito gera uma segunda reunião. O hash e a
       * chave são fixados agora e reusados tal qual no momento da aprovação.
       */
      const hash = await transcriptHash(transcript);
      const info = {
        clientId,
        projectId: target.id,
        meetingDate: meetingDate || new Date().toISOString().slice(0, 10),
        meetingType: meetingType || "",
        participants: participants
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
        transcriptHash: hash,
        transcriptKey: transcriptKey(hash, force),
      };

      const ctx = await ensureProjectContext(target.id);
      return { project: target, context: ctx, info };
    },
    onSuccess: ({ project: p, context: c, info }) => {
      setErrors([]);
      setProject(p);
      setContext(c);
      setDraftInfo(info);
      setMeeting(
        normalizeMeeting({
          client_id: info.clientId,
          project_id: info.projectId,
          meeting_date: info.meetingDate,
          meeting_type: info.meetingType,
          participants: info.participants,
          executive_summary: analysis?.meeting.executive_summary ?? "",
        }),
      );
      setReviewOpen(true);
    },
    onError: (e: Error) => setErrors([e.message]),
  });

  /**
   * Chamada pelo diálogo no início da aprovação (nunca antes): grava a
   * reunião de verdade via a mesma RPC idempotente de sempre, e só então o
   * diálogo prossegue para gravar decisões/ações sobre o `meeting.id` real.
   */
  async function persistDraftMeeting(): Promise<Meeting> {
    if (!draftInfo) throw new Error("Rascunho da reunião não encontrado — reabra o preview.");
    const rpc = await supabase.rpc("get_or_create_smart_meeting", {
      p_client_id: draftInfo.clientId,
      p_project_id: draftInfo.projectId,
      p_transcript_hash: draftInfo.transcriptHash,
      p_transcript_key: draftInfo.transcriptKey,
      p_meeting_date: draftInfo.meetingDate,
      p_meeting_type: draftInfo.meetingType,
      p_participants: draftInfo.participants,
      p_executive_summary: analysis?.meeting.executive_summary || "",
    });
    if (rpc.error) {
      logDbError("meetings", "get_or_create_smart_meeting", rpc.error);
      throw new Error(rpc.error.message);
    }
    const { meeting_id: meetingId, reused } = rpc.data as unknown as {
      meeting_id: string;
      reused: boolean;
    };

    const row = await supabase.from("meetings").select("*").eq("id", meetingId).single();
    if (row.error) {
      logDbError("meetings", "select-created", row.error);
      throw new Error(row.error.message);
    }
    if (reused)
      toast.warning("Esta transcrição já havia sido processada — reaproveitando a reunião existente.");

    const persisted = normalizeMeeting(row.data as Record<string, unknown>);
    setMeeting(persisted);
    for (const key of [["meetings"], ["clients"]]) void qc.invalidateQueries({ queryKey: key });
    return persisted;
  }


  const busy = extractPdf.isPending || runAnalysis.isPending || createAndReview.isPending;
  const effectiveSource = source ?? manualSource(transcript);

  return (
    <>
      <PageHeader
        title="Reunião Inteligente"
        description="PDF ou transcrição colada → extração e validação → análise estruturada → identificação de cliente e projeto → preview → banco de dados."
      >
        <div className="flex flex-wrap items-center gap-4">
          <StepBadge index={1} label="Transcrição" active={step === "captura"} done={step !== "captura"} />
          <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
          <StepBadge
            index={2}
            label="Revisão e análise"
            active={step === "transcricao"}
            done={step === "identificacao"}
          />
          <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
          <StepBadge index={3} label="Identificação e preview" active={step === "identificacao"} done={false} />
        </div>
      </PageHeader>

      <div className="grid gap-4 p-4 md:p-8">
        {errors.length ? (
          <ErrorState message={errors.join(" · ")} onRetry={() => setErrors([])} />
        ) : null}

        {step === "captura" ? (
          <section className="card-surface grid gap-4 p-4 md:p-6">
            <div>
              <h2 className="font-display text-base font-bold">Transcrição da reunião</h2>
              <p className="text-sm text-muted-foreground">
                Envie a transcrição em PDF (texto pesquisável, até {formatBytes(PDF_MAX_BYTES)}) ou cole o
                conteúdo abaixo.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => fileRef.current?.click()} disabled={busy}>
                <Upload className="size-4" aria-hidden />
                Enviar transcrição em PDF
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => handlePdf(e.target.files?.[0])}
              />
              {pdfState === "extraindo" ? (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Extraindo texto do PDF…
                </span>
              ) : null}
            </div>

            {pdfFile ? (
              <div className="grid gap-2 rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{pdfFile.name}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(pdfFile.size)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        pdfState === "pronto" ? "secondary" : pdfState === "erro" ? "destructive" : "outline"
                      }
                    >
                      {pdfState === "aguardando"
                        ? "Aguardando"
                        : pdfState === "extraindo"
                          ? "Extraindo texto"
                          : pdfState === "pronto"
                            ? "Pronto"
                            : "Erro"}
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={clearPdf} disabled={extractPdf.isPending}>
                      <X className="size-4" aria-hidden />
                      Remover
                    </Button>
                  </div>
                </div>

                {extracted ? (
                  <div className="grid gap-2 border-t border-border pt-2">
                    <p className="text-xs text-muted-foreground">
                      Texto identificado: {extracted.pages} páginas ·{" "}
                      {extracted.character_count.toLocaleString("pt-BR")} caracteres
                    </p>
                    <p className="line-clamp-3 text-sm text-muted-foreground">
                      {extracted.text.slice(0, 400)}
                      {extracted.text.length > 400 ? "…" : ""}
                    </p>
                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowFullTranscript((v) => !v)}
                      >
                        {showFullTranscript ? "Ocultar transcrição" : "Ver transcrição completa"}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-1.5">
              <Label htmlFor="transcricao-manual">
                {extracted ? "Texto extraído (editável)" : "Ou cole a transcrição"}
              </Label>
              <Textarea
                id="transcricao-manual"
                rows={extracted && !showFullTranscript ? 6 : 12}
                placeholder="Cole aqui a transcrição ou as anotações da reunião…"
                value={transcript}
                onChange={(e) => {
                  setTranscript(e.target.value);
                  if (!extracted) setSource(null);
                }}
              />
            </div>

            <div>
              <Button
                onClick={() => setStep("transcricao")}
                disabled={transcript.trim().length < MIN_TRANSCRIPT_CHARS || busy}
              >
                Continuar
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </section>
        ) : null}

        {step === "transcricao" ? (
          <section className="card-surface grid gap-4 p-4 md:p-6">
            <div>
              <h2 className="font-display text-base font-bold">Revisão da transcrição</h2>
              <p className="text-sm text-muted-foreground">
                Revise o texto antes da análise — nada é gravado no banco nesta etapa.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{sourceLabel(effectiveSource)}</p>
            </div>
            <Textarea rows={14} value={transcript} onChange={(e) => setTranscript(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => runAnalysis.mutate()}
                disabled={busy || transcript.trim().length < MIN_TRANSCRIPT_CHARS}
              >
                {runAnalysis.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="size-4" aria-hidden />
                )}
                {runAnalysis.isPending ? "Analisando a reunião…" : "Analisar reunião"}
              </Button>
              <Button variant="outline" onClick={() => setStep("captura")} disabled={busy}>
                Voltar
              </Button>
            </div>
            {runAnalysis.isPending ? (
              <p className="text-xs text-muted-foreground">
                Identificando cliente e projeto, organizando decisões e ações e preparando a
                revisão. Isso pode levar alguns instantes em transcrições longas.
              </p>
            ) : null}
          </section>
        ) : null}

        {step === "identificacao" && ident ? (
          <section className="card-surface grid gap-4 p-4 md:p-6">
            <div>
              <h2 className="font-display text-base font-bold">Identificação</h2>
              <p className="text-sm text-muted-foreground">
                {ident.reasoning || "Confirme o cliente e o projeto antes de gravar a reunião."}
              </p>
            </div>

            {contextKnown && !overrideContext ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div className="grid gap-1">
                  <p>
                    <span className="text-muted-foreground">Cliente: </span>
                    <strong>
                      {(clients.data ?? []).find((c) => c.id === clientId)?.company_name ?? "—"}
                    </strong>
                  </p>
                  {presetProject ? (
                    <p>
                      <span className="text-muted-foreground">Projeto: </span>
                      <strong>{presetProject.name}</strong>
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Origem já conhecida — não é preciso selecionar novamente.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setOverrideContext(true)}>
                  Alterar
                </Button>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>Cliente</Label>
                  <ClientCombobox
                    clients={clients.data ?? []}
                    value={clientId}
                    onChange={(id) => {
                      setClientId(id);
                      setProjectId("");
                    }}
                  />
                  {ident.client_name ? (
                    <p className="text-xs text-muted-foreground">
                      Citado na reunião: {ident.client_name}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-1.5">
                  <Label>Projeto</Label>
                  <Select
                    value={projectId || "novo"}
                    onValueChange={(v) => setProjectId(v === "novo" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="novo">Criar novo projeto</SelectItem>
                      {clientProjects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {projectId ? (
                      <Badge variant="secondary">Reunião será vinculada ao projeto existente</Badge>
                    ) : (
                      <Badge variant="outline">Novo projeto proposto pela análise</Badge>
                    )}
                  </p>
                </div>
              </div>
            )}

            {!projectId ? (
              <div className="grid gap-4">
                <ErpAreaSubareaSelect
                  area={newProjectArea}
                  subarea={newProjectSubarea}
                  onChange={(area, subarea) => {
                    setNewProjectArea(area);
                    setNewProjectSubarea(subarea);
                    setNewProjectItem("");
                  }}
                  item={newProjectItem}
                  onItemChange={setNewProjectItem}
                />
                <p className="text-sm text-muted-foreground">
                  Nome do projeto: {newProjectName || "—"}
                </p>
                <div className="grid gap-1.5">
                  <Label htmlFor="novo-projeto-desc">Descrição</Label>
                  <Input
                    id="novo-projeto-desc"
                    value={newProjectDesc}
                    onChange={(e) => setNewProjectDesc(e.target.value)}
                  />
                </div>
              </div>
            ) : null}

            {!projectId && projectMatch.kind !== "NEW_PROJECT" ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium">
                  {projectMatch.kind === "EXACT_MATCH"
                    ? "Projeto já existe neste cliente"
                    : "Projeto semelhante encontrado"}
                </p>
                <p className="text-muted-foreground">
                  {projectMatch.reason} Sugestão: <strong>{projectMatch.existing?.name}</strong>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (projectMatch.existing) setProjectId(projectMatch.existing.id);
                      setConfirmSimilar(false);
                    }}
                  >
                    Usar projeto existente
                  </Button>
                  {projectMatch.kind === "PROBABLE_MATCH" ? (
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={confirmSimilar}
                        onChange={(e) => setConfirmSimilar(e.target.checked)}
                      />
                      Criar mesmo assim (é outro projeto)
                    </label>
                  ) : null}
                </div>
              </div>
            ) : null}


            <div className="grid gap-4 md:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="data-reuniao">Data</Label>
                <Input
                  id="data-reuniao"
                  type="date"
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Tipo</Label>
                <Select value={meetingType} onValueChange={setMeetingType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {MEETING_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!meetingType ? (
                  <p className="text-xs text-muted-foreground">
                    Obrigatório: escolha o tipo da reunião.
                  </p>
                ) : null}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="participantes">Participantes</Label>
                <Input
                  id="participantes"
                  placeholder="Nomes separados por vírgula"
                  value={participants}
                  onChange={(e) => setParticipants(e.target.value)}
                />
              </div>
            </div>

            {analysis?.meeting.executive_summary ? (
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <span className="font-semibold">Resumo executivo: </span>
                {analysis.meeting.executive_summary}
              </div>
            ) : null}

            {alreadyProcessed.data ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium">Esta transcrição parece já ter sido processada.</p>
                <p className="text-muted-foreground">
                  Existe uma reunião de {alreadyProcessed.data.meeting_date} com exatamente este
                  conteúdo para este cliente. Você pode abrir a reunião existente ou processar mesmo
                  assim, se for outra reunião.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (projectId) void navigate({ to: "/projetos/$projectId", params: { projectId } });
                      else void navigate({ to: "/reunioes" });
                    }}
                  >
                    Abrir reunião existente
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => createAndReview.mutate(true)}
                  >
                    Processar mesmo assim
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => createAndReview.mutate(false)}
                disabled={
                  busy ||
                  !clientId ||
                  !meetingType ||
                  (!projectId && !isValidErpPair(newProjectArea, newProjectSubarea))
                }
              >
                {createAndReview.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="size-4" aria-hidden />
                )}
                Gerar preview de aprovação
              </Button>
              <Button variant="outline" onClick={() => setStep("transcricao")} disabled={busy}>
                Voltar
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      <MeetingAnalysisDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        meeting={meeting}
        project={project}
        context={context}
        actions={(actions.data ?? []).filter((a) => a.client_id === meeting?.client_id)}
        risks={(risks.data ?? []).filter((r) => r.client_id === meeting?.client_id)}
        decisions={decisions.data ?? []}
        allDecisions={allClientDecisions.data ?? []}
        clientMeetings={clientMeetings.data ?? []}
        clientProjects={(projects.data ?? [])
          .filter((pr) => pr.client_id === meeting?.client_id)
          .map((pr) => ({ id: pr.id, name: pr.name }))}
        {...(() => {
          const name = (clients.data ?? []).find((c) => c.id === meeting?.client_id)?.company_name;
          return name ? { clientName: name } : {};
        })()}
        opportunities={(opportunities.data ?? []).filter((o) => o.client_id === meeting?.client_id)}
        initialAnalysis={analysis}
        rawAiResponse={rawAiResponse}
        initialTranscript={`${sourceLabel(effectiveSource)}\n\n${transcript}`}
        closeOnApproved
        onPersistDraftMeeting={persistDraftMeeting}
        onApplied={() => {
          // Sempre termina no projeto atualizado — seja ele reaproveitado,
          // recém-criado ou o mesmo de onde o fluxo foi iniciado.
          if (project)
            void navigate({ to: "/projetos/$projectId", params: { projectId: project.id } });
        }}
      />

    </>
  );
}
