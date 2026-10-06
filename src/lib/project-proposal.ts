import { ERP_TAXONOMY } from "@/lib/domain";
import { isValidErpPair } from "@/lib/project-name";

export type ProjectProposal = {
  description: string;
  erp_area: string | null;
  erp_subarea: string | null;
};

/**
 * Lê description/erp_area/erp_subarea de project_proposal (bloco "identification" da IA).
 * Se o par área/subárea não for válido contra ERP_TAXONOMY, devolve AMBOS como null.
 */
export function normalizeProjectProposal(raw: unknown): ProjectProposal {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const area = str(o["erp_area"]) || null;
  const subarea = str(o["erp_subarea"]) || null;
  const valid = isValidErpPair(area, subarea);
  return {
    description: str(o["description"]),
    erp_area: valid ? area : null,
    erp_subarea: valid ? subarea : null,
  };
}

/** Texto com as 14 áreas e subáreas de ERP_TAXONOMY para o prompt da IA — fonte única, nenhum nome escrito à mão. */
export function formatErpTaxonomyForPrompt(): string {
  return Object.entries(ERP_TAXONOMY)
    .map(([area, subareas]) => `${area}: ${subareas.join(", ")}`)
    .join("\n");
}
