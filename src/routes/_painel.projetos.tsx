import { createFileRoute } from "@tanstack/react-router";

import { EmModulo } from "@/components/shared/page-header";

export const Route = createFileRoute("/_painel/projetos")({
  component: () => (
    <EmModulo titulo="Projetos" descricao="Acompanhamento dos projetos por cliente." />
  ),
});
