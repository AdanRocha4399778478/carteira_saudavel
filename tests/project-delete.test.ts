import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canConfirmProjectDelete, PROJECT_DELETE_CONFIRM_WORD } from "../src/lib/project-delete.shared";

/* ------------------------------------------------------------------ *
 * GATE 11B — exclusão administrativa segura de projeto.
 * ------------------------------------------------------------------ */

const root = resolve(import.meta.dir, "..");
function source(path: string): string {
  return readFileSync(resolve(root, ...path.split("/")), "utf8").replace(/\r\n/g, "\n");
}

const migration = source("supabase/migrations/20260914220000_admin_delete_project.sql");
const undoMigration = source("supabase/migrations/20260914161758_admin_undo_meeting.sql");
const serverLib = source("src/lib/project-delete.server.ts");
const functionsLib = source("src/lib/project-delete.functions.ts");
const dialog = source("src/components/painel/ProjectDeleteDialog.tsx");
const projectDetailRoute = source("src/routes/_authenticated/projetos/$projectId.tsx");

// Corpo isolado das duas funções principais, para checar ordem/condições sem
// depender de offsets frágeis do arquivo inteiro.
const previewFnBody = migration.slice(
  migration.indexOf("create or replace function app_private.admin_delete_project_preview"),
  migration.indexOf("create or replace function app_private.admin_delete_project(p_project_id uuid)"),
);
const deleteFnBody = migration.slice(
  migration.indexOf("create or replace function app_private.admin_delete_project(p_project_id uuid)"),
  migration.indexOf("create or replace function public.admin_delete_project_preview"),
);

describe("GATE 11B — admin obrigatório (1, 2)", () => {
  test("preview bloqueia quem não é admin", () => {
    expect(previewFnBody).toContain(
      "if not coalesce(app_private.is_admin(), false) then\n    raise exception 'Apenas administradores podem visualizar o impacto de excluir um projeto.'\n      using errcode = '42501';",
    );
  });

  test("delete bloqueia quem não é admin", () => {
    expect(deleteFnBody).toContain(
      "if not coalesce(app_private.is_admin(), false) then\n    raise exception 'Apenas administradores podem excluir um projeto.'\n      using errcode = '42501';",
    );
  });

  test("nenhuma das funções é concedida a public/anon/service_role", () => {
    expect(migration).toContain(
      "revoke all on function app_private.admin_delete_project_preview(uuid) from public, anon, service_role",
    );
    expect(migration).toContain(
      "revoke all on function app_private.admin_delete_project(uuid) from public, anon, service_role",
    );
    expect(migration).not.toMatch(/grant execute[^;]+to (?:public|anon)/i);
  });
});

describe("GATE 11B — projeto inexistente (3)", () => {
  test("preview e delete rejeitam projeto inexistente com erro seguro (P0002)", () => {
    const notFound = "raise exception 'Projeto % não encontrado.', p_project_id\n      using errcode = 'P0002';";
    expect(migration.split(notFound).length - 1).toBe(2);
  });
});

describe("GATE 11B — bloqueios de dependência operacional (4-10)", () => {
  test("meeting bloqueia", () => {
    expect(previewFnBody).toMatch(
      /elsif v_meetings_count > 0 then\s*\n\s*v_blocking_reason := format\('Existe\(m\) %s reunião/,
    );
  });
  test("action bloqueia", () => {
    expect(previewFnBody).toMatch(/elsif v_actions_count > 0 then/);
  });
  test("risk bloqueia", () => {
    expect(previewFnBody).toMatch(/elsif v_risks_count > 0 then/);
  });
  test("decision bloqueia", () => {
    expect(previewFnBody).toMatch(/elsif v_decisions_count > 0 then/);
  });
  test("opportunity bloqueia", () => {
    expect(previewFnBody).toMatch(/elsif v_opportunities_count > 0 then/);
  });
  test("analysis_application bloqueia", () => {
    expect(previewFnBody).toMatch(/elsif v_analysis_applications_count > 0 then/);
  });
  test("contexto não-vazio bloqueia", () => {
    expect(previewFnBody).toMatch(/elsif not v_context_is_empty then/);
  });

  test("ordem de checagem é determinística: merged -> meetings -> actions -> risks -> decisions -> opportunities -> analysis_applications -> contexto", () => {
    const order = [
      "if v_project.merged_into_project_id is not null then",
      "elsif v_meetings_count > 0 then",
      "elsif v_actions_count > 0 then",
      "elsif v_risks_count > 0 then",
      "elsif v_decisions_count > 0 then",
      "elsif v_opportunities_count > 0 then",
      "elsif v_analysis_applications_count > 0 then",
      "elsif not v_context_is_empty then",
      "else\n    v_can_delete := true;",
    ];
    const indices = order.map((s) => previewFnBody.indexOf(s));
    for (const i of indices) expect(i).toBeGreaterThan(-1);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]!);
    }
  });
});

describe("GATE 11B — orchestrator_recommendations nunca bloqueia (11)", () => {
  test("contada no preview mas nunca aparece na cadeia de bloqueio (confirmado por schema real: FK ON DELETE CASCADE)", () => {
    expect(previewFnBody).toContain("v_orchestrator_recommendations_count");
    expect(previewFnBody).toContain("Informativo apenas");
    // Nenhum "elsif v_orchestrator_recommendations_count" na cadeia de bloqueio.
    expect(previewFnBody).not.toMatch(/elsif v_orchestrator_recommendations_count/);
  });
});

describe("GATE 11B — projeto vazio pode ser excluído (12)", () => {
  test("só chega a can_delete = true quando NENHUMA condição de bloqueio bateu", () => {
    expect(previewFnBody).toContain("v_can_delete boolean := false;");
    expect(previewFnBody).toContain("else\n    v_can_delete := true;\n  end if;");
  });
});

describe("GATE 11B — delete revalida do zero, nunca confia no preview do cliente (13)", () => {
  test("admin_delete_project chama admin_delete_project_preview de novo, internamente, antes de apagar", () => {
    const previewCallIdx = deleteFnBody.indexOf(
      "v_preview := app_private.admin_delete_project_preview(p_project_id);",
    );
    const deleteIdx = deleteFnBody.indexOf("delete from public.projects where id = p_project_id;");
    expect(previewCallIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(previewCallIdx);
  });

  test("aborta se can_delete não for true, mesmo que o cliente ache que pode", () => {
    expect(deleteFnBody).toContain(
      "if not coalesce((v_preview ->> 'can_delete')::boolean, false) then\n    raise exception 'Exclusão bloqueada: %'",
    );
  });

  test("trava a linha do projeto (FOR UPDATE) antes de revalidar, para serializar chamadas concorrentes sobre o MESMO projeto", () => {
    expect(deleteFnBody).toContain("for update;");
    expect(deleteFnBody.indexOf("for update;")).toBeLessThan(
      deleteFnBody.indexOf("app_private.admin_delete_project_preview(p_project_id)"),
    );
  });
});

describe("GATE 11B — único DELETE, sem tabela/id arbitrário (Fase 4, itens 6-10)", () => {
  test("exatamente um DELETE no corpo de admin_delete_project, e é sobre public.projects", () => {
    const deletes = deleteFnBody.match(/delete from public\.\w+/g) ?? [];
    expect(deletes).toEqual(["delete from public.projects"]);
  });

  test("nenhuma das funções aceita nome de tabela como parâmetro — só p_project_id (uuid)", () => {
    expect(migration).not.toMatch(/p_table/i);
    expect(migration.match(/p_project_id uuid/g)?.length).toBeGreaterThanOrEqual(4);
  });
});

describe("GATE 11B — client-safe: regra de confirmação (14)", () => {
  test("PROJECT_DELETE_CONFIRM_WORD é EXCLUIR", () => {
    expect(PROJECT_DELETE_CONFIRM_WORD).toBe("EXCLUIR");
  });

  test("canConfirmProjectDelete exige can_delete=true, texto exato e não estar pendente", () => {
    expect(canConfirmProjectDelete({ canDelete: true, confirmText: "EXCLUIR", isPending: false })).toBe(
      true,
    );
    expect(canConfirmProjectDelete({ canDelete: true, confirmText: "excluir", isPending: false })).toBe(
      false,
    );
    expect(canConfirmProjectDelete({ canDelete: true, confirmText: "EXCLUIR ", isPending: false })).toBe(
      false,
    );
    expect(canConfirmProjectDelete({ canDelete: false, confirmText: "EXCLUIR", isPending: false })).toBe(
      false,
    );
    expect(canConfirmProjectDelete({ canDelete: undefined, confirmText: "EXCLUIR", isPending: false })).toBe(
      false,
    );
    expect(canConfirmProjectDelete({ canDelete: true, confirmText: "EXCLUIR", isPending: true })).toBe(
      false,
    );
  });

  test("UI liga o botão destrutivo a canConfirmProjectDelete, nunca a uma checagem própria", () => {
    expect(dialog).toContain("canConfirmProjectDelete({");
    expect(dialog).toContain("disabled={!canConfirm}");
  });

  test("o input de confirmação só aparece quando can_delete !== false", () => {
    expect(dialog).toContain("impact.can_delete === false ? (");
    expect(dialog).toContain('id="project-delete-confirm"');
  });
});

describe("GATE 11B — botão só para admin (15)", () => {
  test("o botão Excluir projeto está condicionado a isAdmin na tela de detalhe", () => {
    const btnIdx = projectDetailRoute.indexOf("Excluir projeto");
    const guardIdx = projectDetailRoute.lastIndexOf("isAdmin ? (", btnIdx);
    expect(btnIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(btnIdx);
  });

  test("o diálogo de exclusão também só é montado quando isAdmin", () => {
    expect(projectDetailRoute).toContain("{isAdmin ? (\n        <ProjectDeleteDialog");
  });

  test("useAccess é a única fonte de isAdmin usada nesta tela (mesmo hook do resto do app)", () => {
    expect(projectDetailRoute).toContain('import { useAccess } from "@/lib/auth/access"');
    expect(projectDetailRoute).toContain("const { isAdmin } = useAccess();");
  });
});

describe("GATE 11B — nenhum delete direto no frontend (16)", () => {
  test("ProjectDeleteDialog nunca chama supabase.from(\"projects\").delete(", () => {
    expect(dialog).not.toMatch(/from\(["']projects["']\)\.delete\(/);
    expect(dialog).not.toContain("window.confirm");
  });

  test("project-delete.server.ts só fala com o banco via RPC (admin_delete_project / admin_delete_project_preview), nunca .delete(", () => {
    expect(serverLib).not.toMatch(/\.delete\(/);
    expect(serverLib).toContain('supabase.rpc("admin_delete_project_preview"');
    expect(serverLib).toContain('supabase.rpc("admin_delete_project"');
  });

  test("as duas server functions exigem requireSupabaseAuth", () => {
    expect(functionsLib.match(/\.middleware\(\[requireSupabaseAuth\]\)/g)?.length).toBe(2);
  });

  test("nenhum service role em project-delete.server.ts/.functions.ts/UI (a migration só REVOGA service_role, nunca concede)", () => {
    for (const file of [serverLib, functionsLib, dialog]) {
      expect(file).not.toMatch(/service_role/i);
    }
    expect(migration).not.toMatch(/grant[^;]*service_role/i);
    expect(migration.match(/revoke all on function[^;]*service_role/gi)?.length).toBe(4);
  });
});

describe("GATE 11B — admin_undo_meeting não foi alterado (17)", () => {
  test("a nova migration não redefine as funções do undo (só cita o nome uma vez, em comentário de contexto)", () => {
    expect(migration).not.toMatch(/create or replace function[^;]*admin_undo_meeting/);
    expect(migration).not.toMatch(/create or replace function[^;]*preview_admin_undo_meeting/);
    expect(migration.match(/admin_undo_meeting/g)?.length).toBe(1);
  });

  test("a migration do undo continua com sua assinatura original intacta", () => {
    expect(undoMigration).toContain("create or replace function app_private.admin_undo_meeting(p_meeting_id uuid)");
    expect(undoMigration).toContain("create or replace function app_private.preview_admin_undo_meeting(p_meeting_id uuid)");
  });
});

describe("GATE 11B — nenhum force delete (18)", () => {
  test("nenhuma menção a modo force em nenhum arquivo novo", () => {
    for (const file of [migration, serverLib, functionsLib, dialog]) {
      expect(file).not.toMatch(/force[_ ]?delete/i);
      expect(file).not.toMatch(/\bforce\b/i);
    }
  });

  test("as funções SQL não aceitam nenhum parâmetro além de p_project_id — não há como pular a checagem", () => {
    expect(migration).toMatch(/admin_delete_project_preview\(p_project_id uuid\)/);
    expect(migration).toMatch(/admin_delete_project\(p_project_id uuid\)/);
  });
});

describe("GATE 11B — regressão: dedupe/embeddings/meeting-analysis intocados", () => {
  test("nenhum símbolo do GATE 11B aparece em deduplication.ts, embeddings.server.ts ou meeting-analysis.ts", () => {
    const dedupe = source("src/lib/deduplication.ts");
    const embeddings = source("src/lib/embeddings.server.ts");
    const meetingAnalysis = source("src/lib/meeting-analysis.ts");
    for (const forbidden of ["admin_delete_project", "ProjectDeleteDialog", "project-delete"]) {
      expect(dedupe).not.toContain(forbidden);
      expect(embeddings).not.toContain(forbidden);
      expect(meetingAnalysis).not.toContain(forbidden);
    }
  });
});
