import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * Backlog B29 (18/10/2026) — no bloco "Evolução desde a última reunião"
 * do preview da Reunião Inteligente, cada item mostrava o rótulo da
 * classificação DUAS vezes lado a lado: um Pill (texto fixo) e, ao lado,
 * o Select (editável) com o mesmo valor — lido como "Novo Novo",
 * "Avançou Avançou" etc. O Select já cobre exibição + edição; o Pill
 * redundante foi removido. Teste estático por inspeção do código-fonte.
 * ------------------------------------------------------------------ */

function read(path: string): string {
  return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("GATE — B29: rótulo da classificação não aparece duplicado na Evolução", () => {
  const source = read("../src/components/painel/MeetingAnalysisDialog.tsx");
  const blockStart = source.indexOf("Evolução desde a última reunião");
  const blockEnd = source.indexOf("</section>", blockStart);
  const block = source.slice(blockStart, blockEnd);

  test("o bloco existe e foi localizado", () => {
    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);
  });

  test("o Select de classificação de cada item continua lá, com o valor atual", () => {
    expect(block).toContain("value={item.classification}");
    expect(block).toContain("{EVOLUTION_LABEL[c]}");
  });

  test("não há mais um Pill repetindo EVOLUTION_LABEL[item.classification] ao lado do Select", () => {
    expect(block).not.toContain("EVOLUTION_LABEL[item.classification]");
    expect(block).not.toContain("EVOLUTION_TONE[item.classification]");
  });

  test("EVOLUTION_TONE não é mais importado neste arquivo (ficou sem uso depois da remoção)", () => {
    const importBlock = source.slice(0, source.indexOf('from "@/lib/evolution"'));
    expect(importBlock).not.toContain("EVOLUTION_TONE");
  });
});
