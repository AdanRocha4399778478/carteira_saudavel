import { AlertCircle, Inbox, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { classifyError, errorMessageOf } from "@/lib/query-errors";

/** Skeleton do cabeçalho de página (título + filtros). */
export function HeaderSkeleton({ filters = 3 }: { filters?: number }) {
  return (
    <div className="flex flex-col gap-4 border-b border-border px-4 py-6 md:px-8">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-80" />
      {filters > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: filters }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SlowNotice({ onRetry }: { onRetry?: (() => void) | undefined }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl bg-attention-soft p-4 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-center gap-2">
        <AlertCircle className="size-4" aria-hidden />
        A conexão com o banco está demorando mais que o esperado.
      </span>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}

export type SkeletonVariant = "dashboard" | "list" | "detail" | "settings" | "meetings";

function VariantSkeleton({ variant }: { variant: SkeletonVariant }) {
  if (variant === "dashboard") {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 w-full lg:col-span-2" />
          <Skeleton className="h-72 w-full" />
        </div>
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (variant === "meetings") {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  if (variant === "detail") {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (variant === "settings") {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-12 w-full" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function LoadingState({
  label = "Carregando informações…",
  slow = false,
  onRetry,
  variant = "dashboard",
}: {
  label?: string;
  slow?: boolean;
  onRetry?: () => void;
  variant?: SkeletonVariant;
}) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {label}
      </div>
      {slow ? <SlowNotice onRetry={onRetry} /> : null}
      <VariantSkeleton variant={variant} />
    </div>
  );
}

/** Indicador discreto de atualização em segundo plano (não intrusivo). */
export function BackgroundRefreshBadge({ active }: { active?: boolean }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <RefreshCw className="size-3 animate-spin" aria-hidden />
      Atualizando…
    </span>
  );
}

export function ErrorState({
  message,
  error,
  onRetry,
  title,
}: {
  message?: string;
  error?: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const kind = error === undefined ? "permanent" : classifyError(error);
  const text = message ?? errorMessageOf(error, "Ocorreu um erro ao consultar a carteira.");
  const heading =
    title ??
    (kind === "transient"
      ? "Não foi possível carregar estes dados"
      : "Não foi possível carregar esta página");

  return (
    <div className="card-surface flex flex-col items-center gap-3 p-10 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-critical-soft text-critical">
        <AlertCircle className="size-5" aria-hidden />
      </span>
      <h3 className="text-base font-semibold">{heading}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{text}</p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Inbox className="size-5" aria-hidden />
      </span>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
