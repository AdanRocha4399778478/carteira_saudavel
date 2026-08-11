import { ShieldCheck } from "lucide-react";

/** Moldura visual compartilhada pelas telas públicas de autenticação. */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div>
            <p className="font-display font-bold">Resultados S/A</p>
            <p className="text-xs text-sidebar-foreground/60">Uso interno</p>
          </div>
        </div>
        <div className="max-w-md">
          <h2 className="font-display text-3xl leading-tight font-bold">
            Painel de Saúde da Carteira
          </h2>
          <p className="mt-3 text-sm text-sidebar-foreground/70">
            Satisfação do empresário, valor gerado e risco de cancelamento em uma única visão
            executiva — para decidir onde atuar primeiro.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">
          Acesso restrito a consultores e líderes da Resultados S/A.
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="card-surface w-full max-w-md p-6">
          <h1 className="font-display text-xl font-bold">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
