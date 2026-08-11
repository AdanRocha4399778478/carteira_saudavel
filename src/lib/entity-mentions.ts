import { supabase } from "@/lib/supabase/client";
import { logDbError } from "./api";

/* ------------------------------------------------------------------ *
 * RASTREABILIDADE DE MENÇÕES
 *
 * Uma ação pode nascer na reunião A, ser confirmada na B, alterada na C
 * e concluída na D — sem virar quatro ações. Cada uma dessas passagens
 * vira uma linha aqui, com o valor anterior e o novo quando houver
 * alteração (histórico nunca é sobrescrito).
 * ------------------------------------------------------------------ */

export const MENTION_TYPES = [
  "created",
  "confirmed",
  "updated",
  "resolved",
  "reopened",
  "superseded",
] as const;
export type MentionType = (typeof MENTION_TYPES)[number];

export const MENTION_TYPE_LABEL: Record<string, string> = {
  created: "Criado",
  confirmed: "Reconfirmado",
  updated: "Atualizado",
  resolved: "Resolvido",
  reopened: "Reaberto",
  superseded: "Substituído",
};

export type EntityKind =
  | "action"
  | "decision"
  | "risk"
  | "opportunity"
  | "project"
  | "context_item";

export type MentionInput = {
  entity_type: EntityKind;
  entity_id: string;
  meeting_id: string | null;
  analysis_id?: string | null;
  client_id: string | null;
  project_id?: string | null;
  mention_type: MentionType;
  confidence?: number | null;
  reason?: string | null;
  previous_value?: unknown;
  new_value?: unknown;
};

/**
 * Gravação best-effort: rastreabilidade não pode derrubar a aprovação
 * que já persistiu os registros de negócio.
 */
export async function recordMentions(mentions: MentionInput[], userId: string | null) {
  if (mentions.length === 0) return;
  const rows = mentions.map((m) => ({
    entity_type: m.entity_type,
    entity_id: m.entity_id,
    meeting_id: m.meeting_id,
    analysis_id: m.analysis_id ?? null,
    client_id: m.client_id,
    project_id: m.project_id ?? null,
    mention_type: m.mention_type,
    confidence: m.confidence ?? null,
    reason: m.reason ?? null,
    previous_value: (m.previous_value ?? null) as never,
    new_value: (m.new_value ?? null) as never,
    created_by: userId,
  }));
  const { error } = await supabase.from("entity_mentions").upsert(rows, {
    onConflict: "entity_type,entity_id,meeting_id,mention_type",
    ignoreDuplicates: true,
  });
  if (error) logDbError("entity_mentions", "insert", error);
}

export type EntityMention = {
  id: string;
  entity_type: string;
  entity_id: string;
  meeting_id: string | null;
  mention_type: string;
  reason: string | null;
  confidence: number | null;
  previous_value: unknown;
  new_value: unknown;
  created_at: string;
};

/** Histórico de menções de um registro — usado nas telas de detalhe. */
export async function fetchMentions(
  entityType: EntityKind,
  entityId: string,
): Promise<EntityMention[]> {
  const res = await supabase
    .from("entity_mentions")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false });
  if (res.error) {
    logDbError("entity_mentions", "select", res.error);
    return [];
  }
  return (res.data ?? []) as unknown as EntityMention[];
}
