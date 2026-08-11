/**
 * Tipos do banco existente.
 *
 * Mapeamento parcial, construído a partir da inspeção do schema real
 * (tabelas em `public`). Não altera o banco: apenas descreve o que já existe.
 * Deve ser substituído pelo arquivo gerado via
 * `supabase gen types typescript --project-id <id>` quando houver acesso.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface ClientRow {
  id: string;
  company_name: string | null;
  segment: string | null;
  account_status: string | null;
  active: boolean | null;
  consultant_id: string | null;
  start_date: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  created_at: string | null;
}

export interface ProjectRow {
  id: string;
  name: string | null;
  description: string | null;
  status: string | null;
  client_id: string | null;
  consultant_id: string | null;
  start_date: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface MeetingRow {
  id: string;
  client_id: string | null;
  project_id: string | null;
  meeting_date: string | null;
  meeting_type: string | null;
  participants: Json | null;
  created_at: string | null;
}

export interface ActionRow {
  id: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  client_id: string | null;
  meeting_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

type TableDef<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      clients: TableDef<ClientRow>;
      profiles: TableDef<ProfileRow>;
      projects: TableDef<ProjectRow>;
      meetings: TableDef<MeetingRow>;
      actions: TableDef<ActionRow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
