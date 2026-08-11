import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { supabase } from "@/lib/supabase/client";

export interface AuthPerfil {
  fullName: string | null;
  email: string | null;
  role: string | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  perfil: AuthPerfil | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<AuthPerfil | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, novaSessao) => {
      if (!ativo) return;
      setSession(novaSessao);
      if (!novaSessao) setPerfil(null);
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!ativo) return;
      setSession(data.session);
      setCarregando(false);
    });

    return () => {
      ativo = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    let ativo = true;

    void supabase
      .from("profiles")
      .select("full_name, email, role")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!ativo) return;
        setPerfil({
          fullName: data?.full_name ?? null,
          email: data?.email ?? session?.user.email ?? null,
          role: data?.role ?? null,
        });
      });

    return () => {
      ativo = false;
    };
  }, [userId, session?.user.email]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      perfil,
      carregando,
      entrar: async (email, senha) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
      },
      sair: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, perfil, carregando],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de AuthProvider");
  return ctx;
}
