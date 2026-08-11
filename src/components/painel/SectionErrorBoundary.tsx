import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logQueryError } from "@/lib/query-errors";

type Props = {
  /** Nome do componente crítico, usado no log e na mensagem. */
  label: string;
  children: ReactNode;
  className?: string | undefined;
};

type State = { error: Error | null };

/**
 * Error Boundary de componente: isola falhas de gráficos/matriz para que
 * o restante da página (e o shell da aplicação) continue funcionando.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    logQueryError(error, {
      scope: `component:${this.props.label}`,
      queryKey: info.componentStack?.split("\n")[1]?.trim(),
    });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-8 text-center ${this.props.className ?? ""}`}
      >
        <AlertTriangle className="size-5 text-attention" aria-hidden />
        <p className="text-sm text-muted-foreground">
          Não foi possível carregar {this.props.label}.
        </p>
        <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
          Tentar novamente
        </Button>
      </div>
    );
  }
}
