import { createFileRoute } from "@tanstack/react-router";

import { EmModulo } from "@/components/shared/page-header";

export const Route = createFileRoute("/_painel/reunioes")({
  component: () => (
    <EmModulo titulo="Reuniões" descricao="Histórico e agenda de reuniões da carteira." />
  ),
});
