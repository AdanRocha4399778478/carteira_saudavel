import { createFileRoute } from "@tanstack/react-router";

import { EmModulo } from "@/components/shared/page-header";

export const Route = createFileRoute("/_painel/reuniao-inteligente")({
  component: () => (
    <EmModulo
      titulo="Reunião Inteligente"
      descricao="Análises de reunião, decisões, ações e menções de entidades já existentes no backend."
    />
  ),
});
