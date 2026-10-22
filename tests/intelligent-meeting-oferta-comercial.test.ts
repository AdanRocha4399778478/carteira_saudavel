import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ *
 * R4 (22/10/2026, decisão do dono do produto, achado do teste da
 * Bandrone 05/06): oferta comercial do consultor (preço de plano,
 * proposta) não vira ação nem decisão, salvo se o cliente aceitar na
 * reunião. Teste estático (sem chamar a IA) do texto do SYSTEM_PROMPT,
 * no mesmo padrão de intelligent-meeting-values-and-reconciliation.test.ts.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
const source = readFileSync(resolve(root, "src/lib/intelligent-meeting.server.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);

describe("SYSTEM_PROMPT (intelligent-meeting.server.ts) — oferta comercial do consultor (R4)", () => {
  test("oferta comercial do consultor (preço de plano, proposta) não vira ação nem decisão", () => {
    expect(source).toContain(
      "Oferta comercial do consultor (preço de plano da consultoria, valor de honorários, proposta de serviço, escopo ou pacote oferecido pelo consultor ao cliente) NÃO vira ação nem decisão",
    );
  });

  test("exceção: aceite explícito do cliente na própria reunião", () => {
    expect(source).toContain(
      "Ressalva de aceite: se o CLIENTE aceitar de forma explícita na própria reunião",
    );
    expect(source).toContain("Sem aceite explícito, a oferta fica de fora (no máximo uma oportunidade).");
  });

  test("promessa explícita do consultor de enviar proposta/orçamento vira ação do consultor, com o prazo dito e sem preço no texto", () => {
    expect(source).toContain(
      'Ressalva de promessa: quando o CONSULTOR promete de forma explícita enviar a proposta ou o orçamento ("vou te mandar a proposta até sexta"), isso é uma AÇÃO do consultor',
    );
    expect(source).toContain("com o prazo dito na conversa; sem prazo dito, fica sem prazo.");
    expect(source).toContain('NUNCA traz preço, valor, plano ou escopo da oferta.');
  });

  test("o trecho antigo 'nem \"enviar a proposta\"' foi removido", () => {
    expect(source).not.toContain('nem "enviar a proposta"');
  });

  test("não se aplica a preço, plano ou proposta do próprio negócio do cliente", () => {
    expect(source).toContain(
      "Esta regra NÃO se aplica a preço, plano ou proposta do próprio negócio do CLIENTE",
    );
  });

  test("a regra não introduz um 'EXCEÇÃO:' antes da exceção da R32 (indicators-prompt-metas-pessoas lê o primeiro)", () => {
    const rule = source.slice(source.indexOf("Oferta comercial do consultor"), source.indexOf("Quando a reunião adia uma decisão"));
    expect(rule).not.toContain("EXCEÇÃO:");
  });

  test("a regra anterior de ideia/oferta sem aceite continua presente", () => {
    expect(source).toContain(
      'Ideia ou oferta do consultor sem aceite explícito do cliente ("se você quiser", "dá pra fazer", "a gente poderia") NÃO é decisão nem ação.',
    );
  });

  test("a regra de remuneração de pessoa (R31/R32) continua presente", () => {
    expect(source).toContain("Remuneração e avaliação de pessoa identificável: NUNCA registre");
  });
});
