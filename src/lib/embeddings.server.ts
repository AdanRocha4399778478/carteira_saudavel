import { z } from "zod";

/* ------------------------------------------------------------------ *
 * EMBEDDINGS — camada de comparação semântica (servidor)
 *
 * Usado por src/lib/intelligent-meeting.server.ts para calcular o vetor
 * semântico de cada item extraído de uma reunião (e de itens já existentes
 * no banco que ainda não têm vetor calculado). O resultado é usado por
 * src/lib/deduplication.ts para reconhecer que dois textos falam do mesmo
 * assunto mesmo com redação diferente entre reuniões.
 *
 * Modelo: text-embedding-3-small (1536 dimensões, barato: ~$0.02 por
 * 1M tokens). Não é o mesmo modelo usado para a análise da reunião
 * (gpt-4.1-mini) — é uma chamada separada, mais simples e mais barata.
 *
 * Filosofia de falha: embeddings NUNCA bloqueiam a análise da reunião.
 * Se a chamada falhar (rede, cota, timeout), retorna null para os itens
 * afetados — o sistema cai automaticamente para a comparação por texto
 * (comportamento atual, inalterado). Nenhum erro aqui deve impedir o
 * consultor de revisar e aprovar a reunião.
 * ------------------------------------------------------------------ */

const OPENAI_BASE = "https://api.openai.com/v1";
const EMBEDDING_MODEL = "text-embedding-3-small";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BATCH = 96; // limite prático por chamada — a API aceita mais, mas mantém payload pequeno.

const embeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
      index: z.number(),
    }),
  ),
});

/**
 * Calcula o embedding de cada texto em `texts`, na mesma ordem.
 * Textos vazios/whitespace viram `null` na posição correspondente
 * (não são enviados à API — evita gastar chamada com lixo).
 *
 * Nunca lança exceção: falha na API retorna `null` em todas as posições
 * afetadas, e o chamador deve tratar como "sem embedding disponível".
 */
export async function getEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
  const apiKey = process.env["OPENAI_API_KEY"];
  const result: (number[] | null)[] = new Array(texts.length).fill(null);
  if (!apiKey) return result; // sem chave configurada: degrada silenciosamente.

  // Mapeia só os textos não-vazios para o índice original.
  const indexed: { text: string; originalIndex: number }[] = [];
  texts.forEach((t, i) => {
    const trimmed = (t ?? "").trim();
    if (trimmed.length > 0) indexed.push({ text: trimmed.slice(0, 8000), originalIndex: i });
  });
  if (indexed.length === 0) return result;

  const baseUrl = process.env["OPENAI_BASE_URL"] || OPENAI_BASE;

  for (let start = 0; start < indexed.length; start += MAX_BATCH) {
    const batch = indexed.slice(start, start + MAX_BATCH);
    try {
      const vectors = await requestEmbeddingBatch(
        baseUrl,
        apiKey,
        batch.map((b) => b.text),
      );
      if (!vectors) continue; // falha nesse lote: posições ficam null, resto do fluxo segue.
      batch.forEach((b, i) => {
        result[b.originalIndex] = vectors[i] ?? null;
      });
    } catch {
      // Qualquer erro (rede, timeout, parse): lote inteiro fica null, sem exceção propagada.
      continue;
    }
  }

  return result;
}

/** Uma única chamada HTTP em lote. Retorna null (não lança) em qualquer falha. */
async function requestEmbeddingBatch(
  baseUrl: string,
  apiKey: string,
  inputs: string[],
): Promise<(number[] | null)[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: inputs,
      }),
    });

    if (!res.ok) {
      // Consome o corpo para liberar a conexão; não loga conteúdo sensível.
      await res.text().catch(() => "");
      console.warn("[embeddings] falha na chamada", { status: res.status });
      return null;
    }

    const json = await res.json();
    const parsed = embeddingResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("[embeddings] resposta fora do formato esperado");
      return null;
    }

    const out: (number[] | null)[] = new Array(inputs.length).fill(null);
    for (const item of parsed.data.data) {
      if (item.index >= 0 && item.index < out.length) out[item.index] = item.embedding;
    }
    return out;
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    console.warn("[embeddings] erro na chamada", { timeout: isAbort });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
