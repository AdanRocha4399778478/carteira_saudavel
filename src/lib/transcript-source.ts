/* ------------------------------------------------------------------ *
 * Camada de origem da transcrição.
 * O restante do sistema recebe SEMPRE texto — nunca conhece o formato
 * de origem (PDF ou texto colado).
 * ------------------------------------------------------------------ */

export const PDF_MAX_BYTES = 15 * 1024 * 1024; // 15 MB — limite técnico do upload de PDF
export const MIN_TRANSCRIPT_CHARS = 30;

export type TranscriptSource = {
  type: "pdf" | "manual";
  file_name: string | null;
  pages: number | null;
  character_count: number;
  imported_at: string;
};

export type ExtractedTranscript = {
  text: string;
  file_name: string;
  pages: number;
  character_count: number;
};

export class TranscriptExtractionError extends Error {}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Validação do arquivo antes de qualquer processamento pesado. */
export function validatePdfFile(file: File | null | undefined): void {
  if (!file) throw new TranscriptExtractionError("Nenhum arquivo selecionado.");
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) throw new TranscriptExtractionError("Formato inválido: envie um arquivo PDF.");
  if (file.size === 0) throw new TranscriptExtractionError("O arquivo está vazio.");
  if (file.size > PDF_MAX_BYTES)
    throw new TranscriptExtractionError(
      `PDF acima de ${formatBytes(PDF_MAX_BYTES)}. Envie um arquivo menor ou cole a transcrição.`,
    );
}

/**
 * Normaliza apenas problemas técnicos do texto extraído.
 * Não resume, não reescreve e não remove conteúdo relevante.
 */
export function normalizeTranscript(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    // caracteres de controle inválidos (mantém \n e \t)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/-\n(?=\p{Ll})/gu, "") // hifenização quebrada entre linhas
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extrai o texto pesquisável de um PDF. Sem OCR nesta etapa. */
export async function extractTranscriptFromPdf(file: File): Promise<ExtractedTranscript> {
  validatePdfFile(file);

  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  let doc;
  try {
    doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  } catch {
    throw new TranscriptExtractionError(
      "Não foi possível ler este PDF. O arquivo pode estar corrompido ou protegido por senha.",
    );
  }

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim();
    if (text) pages.push(text); // páginas vazias são descartadas
  }
  const numPages = doc.numPages;
  await doc.cleanup();

  const text = normalizeTranscript(pages.join("\n\n"));
  if (text.length < MIN_TRANSCRIPT_CHARS) {
    throw new TranscriptExtractionError(
      "Não encontramos texto pesquisável neste PDF. Envie uma versão com texto selecionável ou cole a transcrição abaixo.",
    );
  }

  return {
    text,
    file_name: file.name,
    pages: numPages,
    character_count: text.length,
  };
}

export function manualSource(text: string): TranscriptSource {
  return {
    type: "manual",
    file_name: null,
    pages: null,
    character_count: text.length,
    imported_at: new Date().toISOString(),
  };
}

export function pdfSource(extracted: ExtractedTranscript, text: string): TranscriptSource {
  return {
    type: "pdf",
    file_name: extracted.file_name,
    pages: extracted.pages,
    character_count: text.length,
    imported_at: new Date().toISOString(),
  };
}

/** Rastreabilidade: linha gravada junto da transcrição da análise. */
export function sourceLabel(source: TranscriptSource): string {
  const parts = [
    source.type === "pdf" ? `PDF ${source.file_name ?? ""}`.trim() : "Transcrição colada",
    source.pages ? `${source.pages} páginas` : null,
    `${source.character_count.toLocaleString("pt-BR")} caracteres`,
    `importado em ${new Date(source.imported_at).toLocaleString("pt-BR")}`,
  ].filter(Boolean);
  return `[fonte: ${parts.join(" · ")}]`;
}
