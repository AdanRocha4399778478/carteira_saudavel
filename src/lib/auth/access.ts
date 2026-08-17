import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";
import type { Profile } from "@/lib/domain";

export type AppRole = Database["public"]["Enums"]["app_role"];

/** Recursos usados pela UI para decidir o que mostrar. Não substitui RLS. */
export type Resource =
  | "clients"
  | "projects"
  | "meetings"
  | "actions"
  | "decisions"
  | "risks"
  | "opportunities"
  | "analyses"
  | "mentions"
  | "profiles"
  | "roles"
  | "risk_rules";

export type Action = "read" | "insert" | "update" | "delete";

export type AccessState = {
  userId: string;
  email: string | null;
  profile: Profile | null;
  roles: AppRole[];
  isAdmin: boolean;
  isConsultant: boolean;
};

/**
 * Matriz de autorização da UI, espelhando as policies do banco.
 * "own" significa "somente registros da carteira do consultor" — o filtro real
 * é aplicado pela RLS; aqui isso só habilita/desabilita controles.
 */
const MATRIX: Record<Resource, Record<Action, "all" | "own" | "none">> = {
  clients: { read: "own", insert: "own", update: "own", delete: "none" },
  projects: { read: "own", insert: "own", update: "own", delete: "none" },
  meetings: { read: "own", insert: "own", update: "own", delete: "none" },
  actions: { read: "own", insert: "own", update: "own", delete: "own" },
  decisions: { read: "own", insert: "own", update: "own", delete: "none" },
  risks: { read: "own", insert: "own", update: "own", delete: "own" },
  opportunities: { read: "own", insert: "own", update: "own", delete: "own" },
  analyses: { read: "own", insert: "own", update: "own", delete: "none" },
  mentions: { read: "own", insert: "own", update: "own", delete: "none" },
  profiles: { read: "all", insert: "none", update: "own", delete: "none" },
  roles: { read: "own", insert: "none", update: "none", delete: "none" },
  risk_rules: { read: "all", insert: "none", update: "none", delete: "none" },
};

export function canFor(state: AccessState | null, resource: Resource, action: Action): boolean {
  if (!state) return false;
  if (state.isAdmin) return true;
  if (!state.isConsultant) return false;
  return MATRIX[resource][action] !== "none";
}

function isAppRole(value: unknown): value is AppRole {
  return value === "admin" || value === "consultant";
}

/**
 * Estado de autorização carregado uma única vez por sessão e compartilhado via
 * cache do TanStack Query (evita dezenas de consultas a profiles/user_roles).
 * A autoridade de papel é exclusivamente a tabela user_roles.
 * Ausência de papel falha de forma segura, sem promover o usuário a consultor.
 */
export const accessQuery = () =>
  queryOptions({
    queryKey: ["access"],
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<AccessState | null> => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) return null;
      const user = auth.user;

      const [profileRes, rolesRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, active")
          .eq("id", user.id)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);

      const profile = (profileRes.data as Profile | null) ?? null;

      const roles = new Set<AppRole>();
      for (const row of rolesRes.data ?? []) {
        if (isAppRole(row.role)) roles.add(row.role);
      }

      const list = [...roles];
      return {
        userId: user.id,
        email: user.email ?? null,
        profile,
        roles: list,
        isAdmin: list.includes("admin"),
        isConsultant: list.includes("consultant"),
      };
    },
  });

export type UseAccess = {
  access: AccessState | null;
  isLoading: boolean;
  isAdmin: boolean;
  isConsultant: boolean;
  roles: AppRole[];
  can: (resource: Resource, action: Action) => boolean;
};

/** Ponto único de leitura de autorização na UI. */
export function useAccess(): UseAccess {
  const { data, isLoading } = useQuery(accessQuery());
  const access = data ?? null;
  return {
    access,
    isLoading,
    isAdmin: access?.isAdmin ?? false,
    isConsultant: access?.isConsultant ?? false,
    roles: access?.roles ?? [],
    can: (resource, action) => canFor(access, resource, action),
  };
}
