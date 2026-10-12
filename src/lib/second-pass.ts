/* ------------------------------------------------------------------ *
 * Segunda passada "o que faltou?" — só roda quando a transcrição é
 * longa e coube num bloco único (bloco único = sem chunking a ajustar
 * ainda; ver shouldRunSecondPass). Funções puras, sem import de
 * servidor — importável direto em teste.
 * ------------------------------------------------------------------ */

export const SECOND_PASS_MIN_CHARS = 12000;

const MAX_ITEMS_PER_CATEGORY = 40;
const MAX_ITEM_CHARS = 160;

/** Com mais de 1 bloco, o chunking já cobre a cobertura — a segunda passada é só para bloco único longo. */
export function shouldRunSecondPass(blockCount: number, transcriptChars: number): boolean {
  return blockCount === 1 && transcriptChars >= SECOND_PASS_MIN_CHARS;
}

function truncate(text: string, max = MAX_ITEM_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function renderList(items: unknown[], render: (item: Record<string, unknown>) => string): string[] {
  const out: string[] = [];
  for (const raw of items) {
    if (out.length >= MAX_ITEMS_PER_CATEGORY) break;
    const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const text = render(item).trim();
    if (text) out.push(`- ${truncate(text)}`);
  }
  return out;
}

function collect(parts: Record<string, unknown>[], key: string): unknown[] {
  const out: unknown[] = [];
  for (const part of parts) {
    const analysis = (part["analysis"] ?? {}) as Record<string, unknown>;
    const value = analysis[key];
    if (Array.isArray(value)) out.push(...value);
  }
  return out;
}

/**
 * Texto compacto do que já foi extraído (todos os blocos da primeira
 * passada), para a segunda chamada não repetir. Cada item truncado em
 * ~160 caracteres, até 40 itens por categoria. Sem nada, devolve "(nada)".
 */
export function summarizeExtracted(parts: Record<string, unknown>[]): string {
  const sections: [string, string[]][] = [
    ["Decisões", renderList(collect(parts, "decisions"), (d) => String(d["title"] ?? ""))],
    [
      "Ações",
      renderList(collect(parts, "actions"), (a) => {
        // Descrição truncada ANTES de anexar o responsável, para a anotação
        // nunca ser cortada por descrição longa (reserva ~40 caracteres).
        const desc = truncate(String(a["description"] ?? ""), MAX_ITEM_CHARS - 40);
        const owner = String(a["owner_name"] ?? "").trim();
        return owner ? `${desc} (responsável: ${owner})` : desc;
      }),
    ],
    ["Riscos", renderList(collect(parts, "risks"), (r) => String(r["title"] ?? ""))],
    [
      "Oportunidades",
      renderList(collect(parts, "opportunities"), (o) => String(o["description"] ?? "")),
    ],
  ];

  const rendered = sections
    .filter(([, lines]) => lines.length > 0)
    .map(([label, lines]) => `${label}:\n${lines.join("\n")}`);

  return rendered.length > 0 ? rendered.join("\n\n") : "(nada)";
}

/**
 * Instrução da segunda chamada: só pede o que falta, nunca revisão nem
 * repetição do que já foi extraído.
 */
export function buildSecondPassInstruction(summary: string): string {
  return [
    `JÁ EXTRAÍDO NESTA REUNIÃO:\n${summary}`,
    "",
    'TAREFA: releia a transcrição inteira e devolva SOMENTE as decisões, ações, riscos e oportunidades que a conversa sustenta e que NÃO estão cobertos pela lista acima, no mesmo formato JSON. Todas as regras do sistema continuam valendo (evidência literal, isolamento de cliente, prazo, responsável). Não repita nem reescreva itens da lista. Se nada faltar, devolva listas vazias. Deixe identification, meeting, speaker_map e as listas de contexto vazias. Procure em especial: compromissos assumidos ("eu vou", "a gente cria", "você cola", "vou pedir ao..."), acordos ("beleza", "combinado", "tá bom") e pendências condicionadas ("antes de definir..."). Cada tarefa com entrega própria é um item separado.',
  ].join("\n");
}
