import { useQuery } from "@tanstack/react-query";

import { listarClientes, listarConsultores } from "../services/clientes.service";

export const clientesKeys = {
  todos: ["clientes"] as const,
  consultores: ["clientes", "consultores"] as const,
};

export function useClientes() {
  return useQuery({ queryKey: clientesKeys.todos, queryFn: listarClientes });
}

export function useConsultores() {
  return useQuery({ queryKey: clientesKeys.consultores, queryFn: listarConsultores });
}
