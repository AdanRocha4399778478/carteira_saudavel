/** Estado mínimo de uma consulta react-query relevante para a prontidão. */
export type QueryReadiness = { isSuccess: boolean };

/**
 * Pronto só quando TODAS as consultas do estado terminaram com sucesso.
 * Desabilitada, pendente, em carregamento ou com erro contam como "não pronto"
 * — no react-query v5, isLoading é falso para consulta desabilitada, então
 * essa checagem não pode depender de isLoading.
 */
export function isOrchestratorStateReady(queries: QueryReadiness[]): boolean {
  return queries.length > 0 && queries.every((q) => q.isSuccess);
}
