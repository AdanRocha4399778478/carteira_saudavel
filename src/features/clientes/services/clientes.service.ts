import { supabase } from "@/lib/supabase/client";
import type { ClientRow } from "@/lib/supabase/database.types";

/** Colunas confirmadas no schema real da tabela `clients`. */
const COLUNAS = "id, company_name, segment, account_status, active, consultant_id, start_date, notes, created_at" as const;

export interface Cliente {
  id: string;
  nome: string;
  segmento: string | null;
  status: string | null;
  ativo: boolean | null;
  consultorId: string | null;
  inicio: string | null;
  observacoes: string | null;
  criadoEm: string | null;
}

function paraCliente(row: ClientRow): Cliente {
  return {
    id: row.id,
    nome: row.company_name ?? "Sem nome",
    segmento: row.segment,
    status: row.account_status,
    ativo: row.active,
    consultorId: row.consultant_id,
    inicio: row.start_date,
    observacoes: row.notes,
    criadoEm: row.created_at,
  };
}

export async function listarClientes(): Promise<Cliente[]> {
  const { data, error } = await supabase
    .from("clients")
    .select(COLUNAS)
    .order("company_name", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => paraCliente(row as ClientRow));
}

export async function listarConsultores(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("profiles").select("id, full_name");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name ?? "—"]));
}
