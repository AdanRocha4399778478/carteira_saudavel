import { createFileRoute } from "@tanstack/react-router";

import { EmModulo } from "@/components/shared/page-header";

export const Route = createFileRoute("/_painel/acoes")({
  component: () => (
    <EmModulo titulo="Ações" descricao="Ações priorizadas geradas a partir das reuniões." />
  ),
});
