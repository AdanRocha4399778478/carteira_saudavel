import { Link, useRouterState } from "@tanstack/react-router";
import {
  Building2,
  CheckSquare,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";

import { useAuth } from "@/features/auth/hooks/use-auth";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const itens = [
  { titulo: "Visão Geral", url: "/visao-geral", icone: LayoutDashboard },
  { titulo: "Clientes", url: "/clientes", icone: Users },
  { titulo: "Projetos", url: "/projetos", icone: FolderKanban },
  { titulo: "Reuniões", url: "/reunioes", icone: Building2 },
  { titulo: "Reunião Inteligente", url: "/reuniao-inteligente", icone: Sparkles },
  { titulo: "Ações", url: "/acoes", icone: CheckSquare },
  { titulo: "Configurações", url: "/configuracoes", icone: Settings },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { perfil, user, sair } = useAuth();

  const nome = perfil?.fullName ?? user?.email ?? "Usuário";
  const iniciais = nome.slice(0, 2).toUpperCase();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-primary" aria-hidden />
          <span className="truncate text-sm font-semibold tracking-tight">Carteira Saudável</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Gestão da carteira</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {itens.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={pathname.startsWith(item.url)}>
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icone className="size-4" />
                      <span>{item.titulo}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
            {iniciais}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{nome}</p>
            <p className="truncate text-xs text-muted-foreground">{perfil?.role ?? "Consultor"}</p>
          </div>
          <button
            type="button"
            onClick={() => void sair()}
            aria-label="Sair"
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
