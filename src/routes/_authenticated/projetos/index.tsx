import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, Plus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/painel/PageHeader";
import { routeErrorComponent } from "@/components/painel/RouteError";
import { EmptyState, ErrorState, LoadingState } from "@/components/painel/states";
import { Pill } from "@/components/painel/badges";
import { ProjectDialog } from "@/components/painel/ProjectDialog";
import { clientsQuery, profilesQuery } from "@/lib/api";
import { projectsQuery, PROJECT_STATUS_LABEL } from "@/lib/projects";
import { formatDate } from "@/lib/domain";
import { HEALTH_TONE, PRIORITY_TONE } from "@/lib/health";
import { useProjectsHealth } from "@/lib/health-portfolio";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/projetos/")({
  head: () => ({
    meta: [
      { title: "Projetos consultivos | Resultados S/A" },
      {
        name: "description",
        content:
          "Lista de projetos consultivos por cliente, com status, responsável e previsão de término.",
      },
      { property: "og:title", content: "Projetos consultivos | Resultados S/A" },
      {
        property: "og:description",
        content: "Gestão dos projetos consultivos da carteira.",
      },
    ],
  }),
  component: ProjectsPage,
  errorComponent: routeErrorComponent("Projetos"),
});

function ProjectsPage() {
  const projects = useQuery(projectsQuery());
  const clients = useQuery(clientsQuery());
  const profiles = useQuery(profilesQuery());
  const [open, setOpen] = useState(false);
  const { rows: healthRows } = useProjectsHealth();

  /* Saúde consultiva por projeto — mesmo motor determinístico da tela do projeto. */
  const healthByProject = useMemo(
    () => new Map(healthRows.map((r) => [r.projectId, r.health])),
    [healthRows],
  );

  const clientName = useMemo(() => {
    const map = new Map((clients.data ?? []).map((c) => [c.id, c.company_name]));
    return (id: string) => map.get(id) ?? "—";
  }, [clients.data]);

  const consultantName = useMemo(() => {
    const map = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name]));
    return (id: string | null) => (id ? (map.get(id) ?? "—") : "—");
  }, [profiles.data]);

  const isLoading = projects.isLoading || clients.isLoading;
  const error = projects.error ?? clients.error;

  return (
    <div className="min-w-0">
      <PageHeader
        title="Projetos consultivos"
        description="Cada cliente pode ter vários projetos, com contexto próprio e histórico de reuniões."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="gap-2">
            <Link to="/reuniao-inteligente">
              <Sparkles className="size-4" aria-hidden /> Nova reunião inteligente
            </Link>
          </Button>
          <Button onClick={() => setOpen(true)} className="gap-2">
            <Plus className="size-4" aria-hidden /> Novo projeto
          </Button>
        </div>
      </PageHeader>

      <div className="px-4 py-6 md:px-8">
        {isLoading ? (
          <LoadingState variant="list" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void projects.refetch()} />
        ) : (projects.data ?? []).length === 0 ? (
          <div className="card-surface">
            <EmptyState
              title="Nenhum projeto cadastrado"
              description="Crie o primeiro projeto consultivo para começar a organizar contexto, reuniões e decisões."
              action={
                <Button onClick={() => setOpen(true)} className="gap-2">
                  <Plus className="size-4" aria-hidden /> Novo projeto
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(projects.data ?? []).map((p) => (
              <li key={p.id}>
                <Link
                  to="/projetos/$projectId"
                  params={{ projectId: p.id }}
                  className="card-surface flex h-full flex-col gap-2 p-4 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                      <FolderKanban className="size-4" aria-hidden />
                    </span>
                    <Pill tone={p.status === "ativo" ? "healthy" : "neutral"}>
                      {PROJECT_STATUS_LABEL[p.status] ?? p.status}
                    </Pill>
                  </div>
                  <p className="min-w-0 truncate text-sm font-semibold">{p.name}</p>
                  {healthByProject.get(p.id) ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Pill tone={HEALTH_TONE[healthByProject.get(p.id)!.status]}>
                        Saúde {healthByProject.get(p.id)!.score}
                      </Pill>
                      <Pill tone={PRIORITY_TONE[healthByProject.get(p.id)!.priority]}>
                        {healthByProject.get(p.id)!.priority}
                      </Pill>
                    </div>
                  ) : null}
                  <p className="truncate text-xs text-muted-foreground">
                    {clientName(p.client_id)}
                  </p>
                  <p className="mt-auto text-xs text-muted-foreground">
                    {consultantName(p.consultant_id)} · término {formatDate(p.target_end_date)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ProjectDialog
        open={open}
        onOpenChange={setOpen}
        clients={clients.data ?? []}
        consultants={profiles.data ?? []}
      />
    </div>
  );
}
