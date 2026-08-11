import { Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Building2,
  CalendarCheck,
  FolderKanban,
  ListChecks,
  LogOut,
  Settings,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { meQuery } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { initialsOf } from "@/lib/domain";

const NAV = [
  { to: "/visao-geral", label: "Visão Geral", icon: Activity },
  { to: "/clientes", label: "Clientes", icon: Building2 },
  { to: "/projetos", label: "Projetos", icon: FolderKanban },
  { to: "/reunioes", label: "Reuniões", icon: CalendarCheck },
  { to: "/reuniao-inteligente", label: "Reunião Inteligente", icon: Sparkles },
  { to: "/acoes", label: "Ações", icon: ListChecks },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

export function AppSidebar() {
  const router = useRouter();
  const { data: me } = useQuery(meQuery());

  const name = me?.profile?.full_name || me?.email || "Usuário";
  const role = me?.profile?.role === "admin" ? "Administrador" : "Consultor";

  async function signOut() {
    await supabase.auth.signOut();
    await router.navigate({ to: "/auth" });
  }

  return (
    <aside className="flex h-dvh w-16 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:w-64">
      <div className="flex items-center gap-3 px-3 py-5 md:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        <div className="hidden min-w-0 md:block">
          <p className="font-display truncate text-sm font-bold">Resultados S/A</p>
          <p className="truncate text-xs text-sidebar-foreground/60">Saúde da Carteira</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2 md:px-3">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            title={label}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-primary"
          >
            <Icon className="size-4.5 shrink-0" aria-hidden />
            <span className="hidden md:inline">{label}</span>
          </Link>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-bold">
            {initialsOf(name) || "US"}
          </span>
          <div className="hidden min-w-0 flex-1 md:block">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-sidebar-foreground/60">{role}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          onClick={signOut}
          className="mt-2 w-full justify-start gap-3 px-3 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className="size-4.5" aria-hidden />
          <span className="hidden md:inline">Sair</span>
        </Button>
      </div>
    </aside>
  );
}
