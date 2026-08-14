import type { Profile } from "@/lib/domain";

/** Perfis antigos sem nome continuam identificáveis no seletor pelo e-mail. */
export function consultantDisplayName(profile: Pick<Profile, "full_name" | "email">): string {
  return profile.full_name.trim() || profile.email?.trim() || "Consultor sem nome";
}

/**
 * Novas atribuições usam apenas membros ativos. Ao editar um registro antigo,
 * preservamos o responsável atual mesmo que ele tenha sido desativado.
 */
export function selectableConsultants(
  profiles: Profile[],
  currentConsultantId?: string | null,
): Profile[] {
  return profiles.filter((profile) => profile.active || profile.id === currentConsultantId);
}
