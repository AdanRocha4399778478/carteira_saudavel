import { PageHeader } from "@/components/painel/PageHeader";
import { ErrorState } from "@/components/painel/states";
import { errorMessageOf, logQueryError } from "@/lib/query-errors";

/**
 * Error Boundary de rota: mantém sidebar/navegação e troca apenas o conteúdo
 * principal. A tela global de erro fica reservada a falhas estruturais.
 */
export function routeErrorComponent(title: string) {
  return function RouteError({ error, reset }: { error: Error; reset: () => void }) {
    logQueryError(error, { scope: `route:${title}` });
    return (
      <>
        <PageHeader title={title} />
        <div className="p-4 md:p-8">
          <ErrorState
            error={error}
            message={`Não conseguimos carregar esta página: ${errorMessageOf(error)}`}
            onRetry={reset}
          />
        </div>
      </>
    );
  };
}
