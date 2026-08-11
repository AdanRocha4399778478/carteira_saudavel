import type { ReactNode } from "react";

export function PageHeader({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  acoes?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>}
      </div>
      {acoes}
    </div>
  );
}

export function EmModulo({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <>
      <PageHeader titulo={titulo} descricao={descricao} />
      <div className="rounded-lg border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Módulo previsto para as próximas etapas. Nenhum dado fictício é exibido aqui.
        </p>
      </div>
    </>
  );
}
