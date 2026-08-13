import { z } from "zod";
import { ORCHESTRATOR_AGENTS, PROJECT_STAGES } from "@/lib/orchestrator/types";

/* ------------------------------------------------------------------ *
 * Orquestrador — camada de IA (somente servidor).
 *
 * A IA NUNCA escolhe o agente quando existe regra determinística forte:
 * nesse caso ela só enriquece motivo, resultado esperado, gargalo e
 * alternativa. Qualquer falha degrada para a recomendação determinística.
 * ------------------------------------------------------------------ */

const OPENAI_BASE = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 45_000;

export const enrichInput = z.object({
  state: z.record(z.string(), z.unknown()),
  deterministic: z.object({
    stage: z.string(),
    agent: z.string(),
    strong: z.boolean(),
    reason: z.string(),
    bottleneck: z.string(),
    evidence: z.array(z.string()),
  }),
});
export type EnrichInput = z.infer<typeof enrichInput>;

export type EnrichOutput = {
  project_stage: string | null;
  main_bottleneck_description: string | null;
  recommended_agent: string | null;
  reason: string | null;
  expected_result: string | null;
  alternative_agent: string | null;
  alternative_reason: string | null;
  erp_classification: { area: string | null; process: string | null };
  used: boolean;
};

const EMPTY: EnrichOutput = {
  project_stage: null,
  main_bottleneck_description: null,
  recommended_agent: null,
  reason: null,
  expected_result: null,
  alternative_agent: null,
  alternative_reason: null,
  erp_classification: { area: null, process: null },
  used: false,
};

const SYSTEM_PROMPT = `Você é o Orquestrador Consultivo da Resultados S/A.
Recebe o ESTADO CONSOLIDADO de um projeto consultivo (apenas contadores, saúde e listas curtas — nunca transcrição) e a recomendação determinística já calculada pelo sistema.

Agentes disponíveis: ${ORCHESTRATOR_AGENTS.join(", ")}.
Estágios possíveis: ${PROJECT_STAGES.join(", ")}.

Regras invioláveis:
- Se "strong" for true, você NÃO pode trocar recommended_agent nem project_stage: devolva exatamente os valores informados e apenas melhore os textos.
- Se "strong" for false, você pode escolher o agente mais adequado entre os disponíveis.
- Nunca invente números, nomes ou fatos que não estejam no estado recebido.
- Português do Brasil, objetivo e consultivo. Sem markdown.
- erp_classification.area e .process só quando o estado indicar claramente (ex.: financeiro, compras, estoque, comercial); caso contrário null.

Responda SOMENTE com JSON válido:
{
  "project_stage": "",
  "main_bottleneck_description": "",
  "recommended_agent": "",
  "reason": "",
  "expected_result": "",
  "alternative_agent": null,
  "alternative_reason": null,
  "erp_classification": { "area": null, "process": null }
}`;

export async function enrichRecommendation(data: EnrichInput): Promise<EnrichOutput> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return EMPTY;

  const baseUrl = process.env["OPENAI_BASE_URL"] || OPENAI_BASE;
  const model = process.env["OPENAI_MODEL"] || "gpt-4.1-mini";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              estado: data.state,
              recomendacao_deterministica: data.deterministic,
            }),
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      await res.text().catch(() => "");
      return EMPTY;
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return EMPTY;

    const parsed = JSON.parse(content) as Record<string, unknown>;
    const asAgent = (v: unknown) =>
      typeof v === "string" && (ORCHESTRATOR_AGENTS as readonly string[]).includes(v) ? v : null;
    const erp = (parsed["erp_classification"] ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

    return {
      project_stage:
        typeof parsed["project_stage"] === "string" &&
        (PROJECT_STAGES as readonly string[]).includes(parsed["project_stage"])
          ? parsed["project_stage"]
          : null,
      main_bottleneck_description: str(parsed["main_bottleneck_description"]),
      recommended_agent: asAgent(parsed["recommended_agent"]),
      reason: str(parsed["reason"]),
      expected_result: str(parsed["expected_result"]),
      alternative_agent: asAgent(parsed["alternative_agent"]),
      alternative_reason: str(parsed["alternative_reason"]),
      erp_classification: { area: str(erp["area"]), process: str(erp["process"]) },
      used: true,
    };
  } catch {
    return EMPTY;
  } finally {
    clearTimeout(timer);
  }
}
