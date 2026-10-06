import { ERP_OFICIAL } from "@/lib/erp-oficial";
import { isValidErpPair } from "@/lib/project-name";

/** Itens (terceiro nível) de uma área/subárea do ERP, ou [] se a área/subárea não existir. */
export function getErpItems(area: string, subarea: string): readonly string[] {
  const areaObj = ERP_OFICIAL.find((a) => a.area === area);
  const subareaObj = areaObj?.subareas.find((s) => s.nome === subarea);
  return subareaObj?.itens ?? [];
}

/**
 * Verdadeiro se (área, subárea) é um par válido e o item é vazio/nulo OU
 * pertence às opções dessa subárea.
 */
export function isValidErpTriple(
  area: string | null | undefined,
  subarea: string | null | undefined,
  item: string | null | undefined,
): boolean {
  if (!isValidErpPair(area, subarea)) return false;
  if (!item) return true;
  return getErpItems(area as string, subarea as string).includes(item);
}

/**
 * Código do ERP por posição em ERP_OFICIAL, começando em 1 (ex.: "2", "2.3", "2.3.3").
 * Nunca gravado — só exibido como apoio visual na escolha do item. Nulo se não achar.
 */
export function erpCode(
  area: string,
  subarea?: string | null,
  item?: string | null,
): string | null {
  const areaIdx = ERP_OFICIAL.findIndex((a) => a.area === area);
  if (areaIdx === -1) return null;
  if (!subarea) return String(areaIdx + 1);

  const subareas = ERP_OFICIAL[areaIdx]!.subareas;
  const subareaIdx = subareas.findIndex((s) => s.nome === subarea);
  if (subareaIdx === -1) return null;
  if (!item) return `${areaIdx + 1}.${subareaIdx + 1}`;

  const itemIdx = subareas[subareaIdx]!.itens.findIndex((i) => i === item);
  if (itemIdx === -1) return null;
  return `${areaIdx + 1}.${subareaIdx + 1}.${itemIdx + 1}`;
}
