import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const dialogSource = read("src/components/painel/MeetingAnalysisDialog.tsx");
const clientPageSource = read("src/routes/_authenticated/clientes/$clientId.tsx");
const analysisSource = read("src/lib/meeting-analysis.ts");
const domainSource = read("src/lib/domain.ts");

/* ------------------------------------------------------------------ *
 * A "taxa de conversão em compromisso" deixou de ser exibida no preview
 * e na ficha do cliente, mas continua calculada e gravada em
 * meetings.commitment_conversion_rate. A taxa de encaminhamento completo
 * continua visível nas duas telas.
 * ------------------------------------------------------------------ */

describe("taxa de conversão em compromisso — escondida, mas ainda gravada", () => {
  test("o preview não exibe mais a taxa de conversão", () => {
    expect(dialogSource).not.toContain("Taxa de conversão em compromisso");
    expect(dialogSource).toContain("Taxa de encaminhamento completo");
  });

  test("a ficha do cliente não exibe mais a taxa de conversão", () => {
    expect(clientPageSource).not.toContain("Conversão em compromisso");
    expect(clientPageSource).toContain("Encaminhamento completo");
  });

  test("o cálculo e a gravação continuam no lugar", () => {
    expect(domainSource).toContain("const commitmentConversionRate");
    expect(dialogSource).toContain(
      "commitmentConversionRate: deliveryClarity.commitmentConversionRate.rate",
    );
    expect(analysisSource).toContain(
      "meetingPatch.commitment_conversion_rate = selection.commitmentConversionRate",
    );
  });
});
