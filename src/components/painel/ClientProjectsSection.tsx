import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, Plus } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/painel/states";
import { Pill } from "@/components/painel/badges";
import { ProjectDialog } from "@/components/painel/ProjectDialog";
import { PROJECT_STATUS_LABEL, type Project } from "@/lib/projects";
import { supabase } from "@/lib/supabase/client";
import { formatDate, type Client } from "@/lib/domain";
import type { PublicProfile } from "@/lib/api";

/** Projetos consultivos de um cliente — exibido dentro da visão do cliente. */
export function ClientProjectsSection({
  clientId,
  clients,
  consultants,
}: {
  clientId: string;
  clients: Client[];
  consultants: PublicProfile[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const projects = useQuery({
    queryKey: ["projects", "client", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<Project[]> => {
      const res = await supabase
        .from("projects")
        .select(
          "id, client_id, name, description, status, start_date, target_end_date, consultant_id, created_by, created_at, updated_at, normalized_name, merged_into_project_id",
        )
        .eq("client_id", clientId)
        .is("merged_into_project_id", null)
        .order("created_at", { ascending: false });
      if (res.error) throw new Error(res.error.message);
      return (res.data ?? []) as Project[];
    },
  });
  const list = projects.data ?? [];

  return (
    <section className="card-surface min-w-0 p-4 md:p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Projetos consultivos</h2>
          <p className="text-xs text-muted-foreground">
            Cada projeto possui contexto próprio, reuniões, decisões e resultados.
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Novo projeto
        </Button>
      </div>

      <div className="mt-4 min-w-0">
        {list.length === 0 ? (
          <EmptyState
            title="Nenhum projeto para este cliente"
            description="Crie um projeto para organizar o contexto consultivo e as reuniões."
            action={<Button onClick={() => setOpen(true)}>Criar projeto</Button>}
          />
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {list.map((p) => (
              <li key={p.id}>
                <Link
                  to="/projetos/$projectId"
                  params={{ projectId: p.id }}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-muted/40 p-3 transition-colors hover:bg-muted"
                >
                  <FolderKanban className="size-4 text-muted-foreground" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      Início {formatDate(p.start_date)} · término {formatDate(p.target_end_date)}
                    </span>
                  </span>
                  <Pill tone={p.status === "ativo" ? "healthy" : "neutral"}>
                    {PROJECT_STATUS_LABEL[p.status] ?? p.status}
                  </Pill>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ProjectDialog
        open={open}
        onOpenChange={setOpen}
        clients={clients}
        consultants={consultants}
        defaultClientId={clientId}
        onCreated={(projectId) =>
          void router.navigate({ to: "/projetos/$projectId", params: { projectId } })
        }
      />
    </section>
  );
}
