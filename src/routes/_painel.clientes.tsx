import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useClientes, useConsultores } from "@/features/clientes/hooks/use-clientes";

export const Route = createFileRoute("/_painel/clientes")({
  component: ClientesPage,
});

function formatarData(valor: string | null) {
  if (!valor) return "—";
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? "—" : data.toLocaleDateString("pt-BR");
}

function ClientesPage() {
  const { data: clientes, isLoading, isError, error, refetch } = useClientes();
  const { data: consultores } = useConsultores();
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return clientes ?? [];
    return (clientes ?? []).filter(
      (c) =>
        c.nome.toLowerCase().includes(termo) || (c.segmento ?? "").toLowerCase().includes(termo),
    );
  }, [clientes, busca]);

  return (
    <>
      <PageHeader
        titulo="Clientes"
        descricao="Carteira consultada diretamente do backend existente."
        acoes={
          <div className="text-right">
            <p className="numerico text-3xl font-semibold">
              {isLoading ? "—" : (clientes?.length ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground">clientes cadastrados</p>
          </div>
        }
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por nome ou segmento"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Buscar clientes"
        />
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6">
          <p className="text-sm font-medium text-destructive">
            Não foi possível carregar os clientes.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {error instanceof Error && error.message.toLowerCase().includes("permission")
              ? "Seu usuário pode não ter permissão para acessar estes dados."
              : "Verifique sua conexão e tente novamente."}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-4 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {!isLoading && !isError && filtrados.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {busca
              ? "Nenhum cliente corresponde à busca."
              : "Nenhum cliente visível para o seu usuário."}
          </p>
        </div>
      )}

      {!isLoading && !isError && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Segmento</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Consultor responsável</TableHead>
                <TableHead>Início</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.map((cliente) => (
                <TableRow key={cliente.id}>
                  <TableCell className="font-medium">{cliente.nome}</TableCell>
                  <TableCell className="text-muted-foreground">{cliente.segmento ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={cliente.ativo === false ? "outline" : "secondary"}>
                      {cliente.status ?? (cliente.ativo === false ? "Inativo" : "Ativo")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {cliente.consultorId ? (consultores?.[cliente.consultorId] ?? "—") : "—"}
                  </TableCell>
                  <TableCell className="numerico text-muted-foreground">
                    {formatarData(cliente.inicio)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
