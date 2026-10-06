import { ERP_TAXONOMY } from "@/lib/domain";

/**
 * Nome do projeto gerado a partir de área/subárea/item do ERP
 * (ex.: "Financeiro - Contas a Pagar" ou "Financeiro - Contas a Pagar - Conciliação").
 * `item` vazio/nulo não entra no nome.
 */
export function buildProjectName(area: string, subarea: string, item?: string | null): string {
  return item ? `${area} - ${subarea} - ${item}` : `${area} - ${subarea}`;
}

/** Verdadeiro só se `area` é uma chave de ERP_TAXONOMY e `subarea` pertence a essa área. */
export function isValidErpPair(
  area: string | null | undefined,
  subarea: string | null | undefined,
): boolean {
  if (!area || !subarea) return false;
  const subareas = ERP_TAXONOMY[area];
  if (!subareas) return false;
  return subareas.includes(subarea);
}
