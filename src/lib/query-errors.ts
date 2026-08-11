/**
 * Classificação de falhas para diferenciar erro transitório, permanente e fatal.
 * Usado pelo React Query (retry) e pelas telas de erro.
 */

export type ErrorKind = "transient" | "permanent" | "fatal";

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);
const PERMANENT_STATUS = new Set([400, 401, 403, 404, 405, 409, 422]);

const TRANSIENT_PATTERNS = [
  "failed to fetch",
  "networkerror",
  "network request failed",
  "load failed",
  "timeout",
  "timed out",
  "aborted",
  "abort",
  "connection",
  "socket",
  "econnreset",
  "fetch failed",
  "upstream",
  "temporarily",
  "too many requests",
];

const PERMANENT_PATTERNS = [
  "permission denied",
  "row-level security",
  "violates",
  "jwt",
  "not authorized",
  "unauthorized",
  "forbidden",
  "does not exist",
  "invalid input",
  "schema",
];

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  const raw = e.status ?? e.statusCode;
  if (typeof raw === "number") return raw;
  if (typeof e.code === "string" && /^\d{3}$/.test(e.code)) return Number(e.code);
  return undefined;
}

export function classifyError(error: unknown): ErrorKind {
  const status = statusOf(error);
  if (status !== undefined) {
    if (TRANSIENT_STATUS.has(status)) return "transient";
    if (PERMANENT_STATUS.has(status)) return "permanent";
  }

  const name = error instanceof Error ? error.name.toLowerCase() : "";
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  const haystack = `${name} ${message}`;

  if (name.includes("retryable")) return "transient";
  if (PERMANENT_PATTERNS.some((p) => haystack.includes(p))) return "permanent";
  if (TRANSIENT_PATTERNS.some((p) => haystack.includes(p))) return "transient";

  // Sem sinal claro: tratamos como transitório para permitir uma nova tentativa
  // silenciosa antes de incomodar o usuário.
  return "transient";
}

export const MAX_QUERY_RETRIES = 2;

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  return classifyError(error) === "transient";
}

/** Backoff curto: 400ms, 900ms. */
export function queryRetryDelay(attemptIndex: number): number {
  return Math.min(400 * 2 ** attemptIndex + 100, 2_000);
}

type LogContext = {
  scope: string;
  queryKey?: unknown;
  route?: string;
};

/**
 * Log de diagnóstico apenas em desenvolvimento. Nunca registra tokens,
 * credenciais ou payloads de cliente — só metadados da falha.
 */
export function logQueryError(error: unknown, context: LogContext) {
  if (!import.meta.env.DEV) return;
  const status = statusOf(error);
  console.warn("[query]", {
    scope: context.scope,
    route: context.route ?? (typeof window !== "undefined" ? window.location.pathname : null),
    queryKey: context.queryKey ? JSON.stringify(context.queryKey) : null,
    kind: classifyError(error),
    status: status ?? null,
    message: error instanceof Error ? error.message : String(error ?? ""),
    at: new Date().toISOString(),
  });
}

export function errorMessageOf(error: unknown, fallback = "Erro inesperado"): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}
