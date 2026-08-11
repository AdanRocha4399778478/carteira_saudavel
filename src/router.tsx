import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { queryRetryDelay, shouldRetryQuery } from "./lib/query-errors";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Falhas transitórias (rede, timeout, 5xx) são retentadas em silêncio;
        // 400/401/403/404 e erros de validação falham na primeira tentativa.
        retry: (failureCount, error) => shouldRetryQuery(failureCount, error),
        retryDelay: queryRetryDelay,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        // Uma consulta que já falhou não recomeça sozinha ao remontar a tela:
        // evita loop de "carregando" infinito quando o banco está indisponível.
        retryOnMount: false,
        // Mantém os dados anteriores visíveis enquanto a nova consulta roda,
        // evitando tela vazia na troca de página/filtro.
        placeholderData: <T,>(prev: T) => prev,
      },
      mutations: {
        retry: 0,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // Evita flash de tela branca/erro em transições rápidas.
    defaultPendingMs: 200,
    defaultPendingMinMs: 300,
  });

  return router;
};
