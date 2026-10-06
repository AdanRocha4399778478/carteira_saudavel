import { isValidErpTriple } from "@/lib/erp-hierarchy";
import { normalizeProjectName, type Project } from "@/lib/projects";

export type ClassificationState = "vazia" | "completa" | "parcial";

/**
 * "vazia" quando área, subárea e item estão todos vazios; "completa" quando
 * área e subárea formam um par válido (item é opcional); "parcial" em
 * qualquer outro caso (ex.: só área, ou item que não pertence à subárea).
 */
export function classificationState(
  area: string | null | undefined,
  subarea: string | null | undefined,
  item: string | null | undefined,
): ClassificationState {
  if (!area && !subarea && !item) return "vazia";
  if (isValidErpTriple(area, subarea, item)) return "completa";
  return "parcial";
}

/**
 * Verdadeira só se as três propriedades de classificação vieram na consulta
 * (nulo conta como carregado; `undefined` significa que a coluna não foi
 * selecionada e não deve ser tratada como "sem classificação").
 */
export function classificationLoaded(project: {
  erp_area?: unknown;
  erp_subarea?: unknown;
  erp_item?: unknown;
}): boolean {
  return (
    project.erp_area !== undefined &&
    project.erp_subarea !== undefined &&
    project.erp_item !== undefined
  );
}

export type UniqueConflictKind = "classificacao" | "nome" | "outro";

/**
 * Identifica qual índice único do banco causou um erro 23505, a partir do
 * texto do erro do Postgres (message/details). Devolve null se não for 23505.
 */
export function detectUniqueConflict(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}): UniqueConflictKind | null {
  if (error.code !== "23505") return null;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  if (text.includes("projects_client_erp_classification_uidx")) return "classificacao";
  if (text.includes("projects_client_normalized_name_uidx")) return "nome";
  return "outro";
}

/**
 * Projeto vivo (não mesclado) do mesmo cliente, diferente de `excludeId`, que
 * conflita pela mesma classificação (kind "classificacao") ou pelo mesmo
 * nome normalizado (kind "nome"). Null se nenhum candidato conflitar.
 */
export function findConflictingProject(
  projects: Project[],
  kind: UniqueConflictKind,
  params: {
    clientId: string;
    excludeId: string;
    area?: string | null;
    subarea?: string | null;
    item?: string | null;
    name?: string;
  },
): Project | null {
  const candidates = projects.filter(
    (p) =>
      p.client_id === params.clientId && p.id !== params.excludeId && !p.merged_into_project_id,
  );

  if (kind === "classificacao") {
    const area = params.area ?? "";
    const subarea = params.subarea ?? "";
    const item = params.item ?? "";
    return (
      candidates.find(
        (p) =>
          (p.erp_area ?? "") === area &&
          (p.erp_subarea ?? "") === subarea &&
          (p.erp_item ?? "") === item,
      ) ?? null
    );
  }

  if (kind === "nome") {
    const norm = normalizeProjectName(params.name ?? "");
    return candidates.find((p) => normalizeProjectName(p.name) === norm) ?? null;
  }

  return null;
}
