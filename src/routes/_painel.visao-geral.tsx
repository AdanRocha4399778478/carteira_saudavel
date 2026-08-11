import { createFileRoute } from "@tanstack/react-router";

import { EmModulo } from "@/components/shared/page-header";

export const Route = createFileRoute("/_painel/visao-geral")({
  component: () => (
    <EmModulo
      titulo="Visão Geral"
      descricao="Indicadores consolidados da carteira. Serão construídos após o mapeamento completo dos dados."
    />
  ),
});
