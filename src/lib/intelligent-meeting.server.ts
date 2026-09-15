import { z } from "zod";
import { splitTranscript } from "@/lib/transcript-chunking";
import { getEmbeddings } from "@/lib/embeddings.server";
import { consolidateAnalysis } from "@/lib/analysis-consolidation";

/* ------------------------------------------------------------------ *
 * REUNIÃO INTELIGENTE — camada de IA (servidor)
 * transcrição → chunks → análises parciais → consolidação → JSON.
 * Nenhuma chave é exposta ao navegador.
 * ------------------------------------------------------------------ */

const MAX_BLOCKS = 6;

/* Provedor de IA: exclusivamente OpenAI (OPENAI_API_KEY), somente no servidor.
 * Não há fallback automático para nenhum outro provedor/gateway. */
const OPENAI_BASE = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 3;

export type AiErrorType =
  | "AUTH_ERROR"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE";

const MESSAGES: Record<AiErrorType, string> = {
  AUTH_ERROR: "Não foi possível autenticar no serviço de IA. Verifique a configuração da API.",
  QUOTA_EXCEEDED:
    "A conta de IA está sem créditos disponíveis. A transcrição foi preservada. Adicione créditos e tente novamente.",
  RATE_LIMIT: "O serviço de IA está temporariamente ocupado. Tente novamente em alguns instantes.",
  TIMEOUT:
    "A análise demorou mais do que o esperado. A transcrição foi preservada e você pode tentar novamente.",
  PROVIDER_ERROR: "O serviço de IA não conseguiu processar a reunião. Tente novamente.",
  INVALID_RESPONSE: "A IA devolveu um resultado fora do formato esperado. Tente novamente.",
};

export class AiProviderError extends Error {
  readonly type: AiErrorType;
  readonly retryable: boolean;
  readonly httpStatus: number | undefined;
  constructor(type: AiErrorType, httpStatus?: number) {
    super(MESSAGES[type]);
    this.name = "AiProviderError";
    this.type = type;
    this.httpStatus = httpStatus;
    this.retryable = type === "RATE_LIMIT" || type === "TIMEOUT" || type === "PROVIDER_ERROR";
  }
}

/** Log seguro: nunca inclui chave, headers ou conteúdo da transcrição. */
function logAi(entry: {
  status: "ok" | "error";
  error_type?: AiErrorType;
  http_status?: number | undefined;
  attempt_count: number;
  analysis_id?: string | undefined;
}) {
  console.info("[ia]", {
    provider: "openai",
    ...entry,
    timestamp: new Date().toISOString(),
  });
}

type Provider = { baseUrl: string; apiKey: string; model: string };

function resolveProvider(): Provider {
  const openaiKey = process.env["OPENAI_API_KEY"];
  if (!openaiKey) throw new AiProviderError("AUTH_ERROR");
  return {
    baseUrl: process.env["OPENAI_BASE_URL"] || OPENAI_BASE,
    apiKey: openaiKey,
    model: process.env["OPENAI_MODEL"] || "gpt-4.1-mini",
  };
}



/* ---------------- entrada ---------------- */

export const analyzeInput = z.object({
  transcript: z.string().min(30, "Transcrição muito curta para análise."),
  clients: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  projects: z
    .array(z.object({ id: z.string(), client_id: z.string(), name: z.string(), status: z.string() }))
    .default([]),
  currentContext: z.string().optional(),
  projectContext: z.string().optional(),
  openActions: z.array(z.string()).default([]),
  overdueActions: z.array(z.string()).default([]),
  pendingDecisions: z.array(z.string()).default([]),
  activeRisks: z.array(z.string()).default([]),
  source: z
    .object({
      type: z.enum(["pdf", "manual"]),
      file_name: z.string().nullable().default(null),
    })
    .optional(),
});

const SYSTEM_PROMPT = `Você é o analista sênior de reuniões consultivas da Resultados S/A.
Recebe a transcrição de uma reunião e devolve SOMENTE um JSON válido, sem markdown.

Regras:
- Escreva tudo em português do Brasil.
- Classifique cada item como "fact" (dito explicitamente), "inference" (deduzido) ou "suggestion" (sua recomendação).
- Nunca invente nomes, números, responsáveis ou prazos que não estejam na transcrição; use "" quando não houver.
- Registre a evidência (trecho ou paráfrase curta da fala) sempre que possível.
- Separe DECISÃO (algo definido) de AÇÃO (algo a executar, com responsável/prazo quando citados).
- Riscos só quando sustentados pela reunião. Oportunidades só com evidência real (upsell, cross-sell, novo projeto, nova unidade, expansão, indicação) — elogio não é oportunidade.
- Identifique o cliente e o projeto comparando com as listas fornecidas. Se nenhum projeto existente corresponder, proponha um novo (project_id = null e preencha project_proposal).
- Confiança é um número de 0 a 1. Se não tiver certeza, use confiança baixa em vez de escolher no chute.
- A pauta recomendada deve ser específica ao cliente, considerando ações abertas/atrasadas, decisões pendentes e riscos críticos informados.
- Em context_updates, TODAS as listas (objectives, problems, root_causes, priorities, hypotheses, constraints, results, next_steps) devem ser arrays de objetos {"content": "texto", "classification": "fact|inference|suggestion"}. Nunca devolva string solta, objeto solto nem arrays aninhados. Se não houver itens, devolva [].
- ACTION FIRST: "next_steps" é só para direções estratégicas contínuas, sem uma entrega única e concluível (ex.: "acompanhar a evolução da saúde financeira nos próximos ciclos"). Qualquer item que exija fazer, entregar, verificar, analisar, enviar, negociar, cobrar, configurar, agendar, acompanhar algo pontual, preparar ou implementar algo concreto DEVE virar um item em "actions", nunca ficar só em "next_steps". Não repita o mesmo item nas duas listas.
- Evite fragmentar o mesmo assunto em vários itens quase idênticos dentro da mesma lista (ex.: "reduzir antecipação" e "sair da antecipação automática" separados) — escreva um único item por assunto, com a formulação mais completa. Isso não impede que o MESMO tema apareça em papéis diferentes (problema, causa, hipótese, decisão, ação) quando cada papel realmente for distinto.

Formato exigido:
{
  "identification": {
    "client_id": "uuid ou null",
    "client_name": "nome citado na reunião",
    "client_confidence": 0.0,
    "client_evidence": "",
    "project_id": "uuid ou null",
    "project_name": "",
    "project_confidence": 0.0,
    "project_status": "existing_project|new_project|uncertain",
    "project_proposal": { "name": "", "description": "", "objective": "" },
    "meeting_date": "AAAA-MM-DD ou \\"\\"",
    "meeting_type": "",
    "participants": ["Nome"],
    "reasoning": "1 a 2 frases explicando a identificação"
  },
  "analysis": {
    "meeting": { "executive_summary": "", "main_topic": "", "measurable_result": "" },
    "context_updates": {
      "objectives": [{ "content": "", "classification": "fact" }],
      "problems": [], "root_causes": [], "priorities": [],
      "hypotheses": [], "constraints": [], "results": [], "next_steps": []
    },
    "decisions": [{ "title": "", "description": "", "reason": "", "owner": "", "due_date": "", "evidence": "", "classification": "fact" }],
    "actions": [{ "description": "", "owner_name": "", "deadline": "", "priority": "alta|média|baixa", "evidence": "", "classification": "fact" }],
    "risks": [{ "title": "", "description": "", "level": "baixo|médio|alto|crítico", "impact": "", "probability": "", "evidence": "", "recommendation": "", "classification": "inference" }],
    "opportunities": [{ "description": "", "expected_benefit": "", "evidence": "", "classification": "inference" }],
    "agenda_recommendation": {
      "objective": "", "topics": [], "pending_decisions": [],
      "overdue_actions": [], "critical_risks": [], "recommended_questions": []
    }
  }
}`;

/* ---------------- chamada ao provedor de IA ---------------- */

/** Uma tentativa: timeout controlado, sem efeito colateral (nada é persistido aqui). */
async function requestCompletion(provider: Provider, userPrompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (res.status === 429) {
      const body = await res.text().catch(() => "");
      // Cota/créditos esgotados não são transitórios: não faz sentido repetir.
      if (/insufficient_quota|credit_balance_exhausted|quota/i.test(body)) {
        throw new AiProviderError("QUOTA_EXCEEDED", res.status);
      }
      throw new AiProviderError("RATE_LIMIT", res.status);
    }
    if (res.status === 401 || res.status === 403) {
      throw new AiProviderError("AUTH_ERROR", res.status);
    }
    if (res.status === 402) throw new AiProviderError("QUOTA_EXCEEDED", res.status);
    if (!res.ok) {
      // Corpo lido apenas para descartar a conexão; nada sensível é registrado.
      await res.text().catch(() => "");
      throw new AiProviderError(res.status >= 500 ? "PROVIDER_ERROR" : "INVALID_RESPONSE", res.status);
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

export async function callGateway(
  userPrompt: string,
  analysisId?: string,
): Promise<Record<string, unknown>> {
  const provider = resolveProvider();

  let raw = "";
  let lastError: AiProviderError | undefined;
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    try {
      raw = await requestCompletion(provider, userPrompt);
      lastError = undefined;
      break;
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      lastError =
        error instanceof AiProviderError
          ? error
          : new AiProviderError(isAbort ? "TIMEOUT" : "PROVIDER_ERROR");
      if (!lastError.retryable || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }

  if (lastError) {
    logAi({
      status: "error",
      error_type: lastError.type,
      http_status: lastError.httpStatus,
      attempt_count: attempts,
      analysis_id: analysisId,
    });
    throw lastError;
  }

  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    logAi({ status: "ok", attempt_count: attempts, analysis_id: analysisId });
    return parsed;
  } catch {
    logAi({
      status: "error",
      error_type: "INVALID_RESPONSE",
      attempt_count: attempts,
      analysis_id: analysisId,
    });
    throw new AiProviderError("INVALID_RESPONSE");

  }
}


/* ---------------- consolidação de blocos ---------------- */

function norm(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  // Achata arrays aninhados: chunks às vezes devolvem [["a"],["b"]].
  return Array.isArray(v) ? v.flat(3) : v === null || v === undefined ? [] : [v];
}


/** União sem duplicidades, preservando o item mais completo (com evidência). */
function mergeList(target: unknown[], incoming: unknown[], keys: string[]): unknown[] {
  const out = [...target];
  const seen = new Map<string, number>();
  out.forEach((item, i) => {
    const k = keyOf(item, keys);
    if (k) seen.set(k, i);
  });
  for (const item of incoming) {
    const k = keyOf(item, keys);
    if (!k) continue;
    const at = seen.get(k);
    if (at === undefined) {
      seen.set(k, out.length);
      out.push(item);
      continue;
    }
    // conflito: mantém o item com mais informação preenchida
    const current = out[at];
    if (score(item) > score(current)) out[at] = item;
  }
  return out;
}

function keyOf(item: unknown, keys: string[]): string {
  if (typeof item === "string") return norm(item);
  const o = obj(item);
  for (const k of keys) {
    const value = norm(o[k]);
    if (value) return value;
  }
  return "";
}

function score(item: unknown): number {
  if (typeof item === "string") return item.length;
  return Object.values(obj(item)).filter((v) => String(v ?? "").trim().length > 0).length;
}

export function consolidate(parts: Record<string, unknown>[]): Record<string, unknown> {
  const first = parts[0] ?? {};
  const identification = obj(first["identification"]);
  const analysis = obj(first["analysis"]);

  // identificação: mantém a de maior confiança entre os blocos
  for (const part of parts.slice(1)) {
    const cand = obj(part["identification"]);
    if (Number(cand["client_confidence"] ?? 0) > Number(identification["client_confidence"] ?? 0)) {
      Object.assign(identification, cand);
    }
  }

  const contextUpdates = obj(analysis["context_updates"]);
  const agenda = obj(analysis["agenda_recommendation"]);

  for (const part of parts.slice(1)) {
    const a = obj(part["analysis"]);

    const meeting = obj(analysis["meeting"]);
    const otherMeeting = obj(a["meeting"]);
    for (const field of ["executive_summary", "main_topic", "measurable_result"]) {
      const cur = String(meeting[field] ?? "").trim();
      const next = String(otherMeeting[field] ?? "").trim();
      if (!cur && next) meeting[field] = next;
      else if (field === "executive_summary" && next && !norm(cur).includes(norm(next).slice(0, 40))) {
        meeting[field] = `${cur} ${next}`.trim();
      }
    }
    analysis["meeting"] = meeting;

    const otherContext = obj(a["context_updates"]);
    for (const key of new Set([...Object.keys(contextUpdates), ...Object.keys(otherContext)])) {
      contextUpdates[key] = mergeList(arr(contextUpdates[key]), arr(otherContext[key]), [
        "content",
        "text",
        "description",
      ]);
    }

    analysis["decisions"] = mergeList(arr(analysis["decisions"]), arr(a["decisions"]), [
      "title",
      "description",
    ]);
    analysis["actions"] = mergeList(arr(analysis["actions"]), arr(a["actions"]), ["description"]);
    analysis["risks"] = mergeList(arr(analysis["risks"]), arr(a["risks"]), ["description", "title"]);
    analysis["opportunities"] = mergeList(arr(analysis["opportunities"]), arr(a["opportunities"]), [
      "description",
    ]);

    const otherAgenda = obj(a["agenda_recommendation"]);
    for (const key of [
      "topics",
      "pending_decisions",
      "overdue_actions",
      "critical_risks",
      "recommended_questions",
    ]) {
      agenda[key] = mergeList(arr(agenda[key]), arr(otherAgenda[key]), []);
    }
    if (!String(agenda["objective"] ?? "").trim()) agenda["objective"] = otherAgenda["objective"] ?? "";
  }

  analysis["context_updates"] = contextUpdates;
  analysis["agenda_recommendation"] = agenda;
  return { identification, analysis };
}


/* ---------------- orquestração: chunks → análises → consolidação ---------------- */

export type MeetingAnalysisInput = z.infer<typeof analyzeInput>;

export async function runMeetingAnalysis(data: MeetingAnalysisInput) {
  const blocks = splitTranscript(data.transcript).slice(0, MAX_BLOCKS);

  const header = (block: { index: number; total: number }) =>
    [
      `Data de hoje: ${new Date().toISOString().slice(0, 10)}`,
      data.source
        ? `Origem da transcrição: ${data.source.type === "pdf" ? `PDF ${data.source.file_name ?? ""}` : "texto colado"}`
        : "",
      block.total > 1 ? `Este é o bloco ${block.index} de ${block.total} da transcrição.` : "",
      `Clientes cadastrados: ${JSON.stringify(data.clients)}`,
      `Projetos cadastrados: ${JSON.stringify(data.projects)}`,
      data.projectContext || data.currentContext
        ? `Contexto atual do projeto: ${data.projectContext ?? data.currentContext}`
        : "",
      data.openActions.length ? `Ações abertas: ${JSON.stringify(data.openActions)}` : "",
      data.overdueActions.length ? `Ações atrasadas: ${JSON.stringify(data.overdueActions)}` : "",
      data.pendingDecisions.length
        ? `Decisões pendentes: ${JSON.stringify(data.pendingDecisions)}`
        : "",
      data.activeRisks.length ? `Riscos ativos: ${JSON.stringify(data.activeRisks)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

  const parts: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const prompt = [header(block), "", "Transcrição da reunião:", block.text].join("\n");
    parts.push(await callGateway(prompt));
  }

  const mergedByKey = consolidate(parts) as {
    identification?: unknown;
    analysis?: Record<string, unknown>;
  };

  // GATE 12: consolidate() acima só une blocos por CHAVE EXATA normalizada —
  // não reconhece "sair da antecipação automática" e "reduzir antecipação"
  // como o mesmo assunto (textos diferentes). consolidateAnalysis roda uma
  // etapa fuzzy adicional (reaproveitando o mesmo similarity() textual do
  // dedupe, nível 2) dentro da análise já unida, e converte next_steps
  // executáveis em actions (action-first) — tudo isso é ANTERIOR ao dedupe
  // contra o banco (matchAction/matchDecision/...), que continua intocado.
  const { result: consolidated, quality } = consolidateAnalysis(mergedByKey as Record<string, unknown>) as {
    result: { identification?: unknown; analysis?: Record<string, unknown> };
    quality: ReturnType<typeof consolidateAnalysis>["quality"];
  };

  // Calcula o vetor semântico de cada item extraído nesta reunião — usado
  // depois pelo preview (MeetingAnalysisDialog) para reconhecer continuidade
  // com itens já existentes, mesmo quando a redação muda entre reuniões.
  // Nunca lança exceção: falha aqui só significa que esses itens vão cair
  // no método de comparação por texto (comportamento anterior, inalterado).
  const analysisOut = consolidated.analysis ?? {};
  analysisOut["execution_quality"] = quality;
  const decisionsOut = Array.isArray(analysisOut["decisions"]) ? (analysisOut["decisions"] as Record<string, unknown>[]) : [];
  const actionsOut = Array.isArray(analysisOut["actions"]) ? (analysisOut["actions"] as Record<string, unknown>[]) : [];
  const risksOut = Array.isArray(analysisOut["risks"]) ? (analysisOut["risks"] as Record<string, unknown>[]) : [];
  const opportunitiesOut = Array.isArray(analysisOut["opportunities"])
    ? (analysisOut["opportunities"] as Record<string, unknown>[])
    : [];

  const embeddingTexts = [
    ...decisionsOut.map((d) => String(d["title"] ?? "")),
    ...actionsOut.map((a) => String(a["description"] ?? "")),
    ...risksOut.map((r) => String(r["description"] ?? "")),
    ...opportunitiesOut.map((o) => String(o["description"] ?? "")),
  ];
  const vectors = await getEmbeddings(embeddingTexts).catch(() => embeddingTexts.map(() => null));
  let cursor = 0;
  for (const d of decisionsOut) d["embedding"] = vectors[cursor++] ?? null;
  for (const a of actionsOut) a["embedding"] = vectors[cursor++] ?? null;
  for (const r of risksOut) r["embedding"] = vectors[cursor++] ?? null;
  for (const o of opportunitiesOut) o["embedding"] = vectors[cursor++] ?? null;

  return { json: JSON.stringify(consolidated), blocks: blocks.length };
}
