type ConsultantIdentity = {
  full_name: string;
  email?: string | null;
};

type SelectableConsultant = {
  id: string;
  active: boolean;
};

/**
 * Perfis completos ainda podem usar o e-mail como fallback. Leituras públicas
 * reduzidas exibem um rótulo neutro quando o nome não estiver preenchido.
 */
export function consultantDisplayName(profile: ConsultantIdentity): string {
  return profile.full_name.trim() || profile.email?.trim() || "Consultor sem nome";
}

/**
 * Novas atribuições usam apenas membros ativos. Ao editar um registro antigo,
 * preservamos o responsável atual mesmo que ele tenha sido desativado.
 */
export function selectableConsultants<T extends SelectableConsultant>(
  profiles: T[],
  currentConsultantId?: string | null,
): T[] {
  return profiles.filter((profile) => profile.active || profile.id === currentConsultantId);
}
