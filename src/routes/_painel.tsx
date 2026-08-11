import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/features/auth/hooks/use-auth";

export const Route = createFileRoute("/_painel")({
  ssr: false,
  component: PainelLayout,
});

function PainelLayout() {
  const { session, carregando } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!carregando && !session) void navigate({ to: "/login", replace: true });
  }, [carregando, session, navigate]);

  if (carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando sessão…
      </div>
    );
  }

  if (!session) return null;

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 items-center gap-2 border-b border-border px-3">
            <SidebarTrigger />
          </header>
          <main className="flex-1 p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
