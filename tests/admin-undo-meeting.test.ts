import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const migration = readFileSync(
  resolve(root, "supabase", "migrations", "20260914161758_admin_undo_meeting.sql"),
  "utf8",
).replace(/\r\n/g, "\n");
const meetingAnalysis = readFileSync(resolve(root, "src", "lib", "meeting-analysis.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);
const projects = readFileSync(resolve(root, "src", "lib", "projects.ts"), "utf8").replace(/\r\n/g, "\n");

describe("GATE 9D — desfazer reunião", () => {
  test("bloqueia não-admin e não expõe função privilegiada a anon ou PUBLIC", () => {
    expect(migration.match(/if not coalesce\(app_private\.is_admin\(\), false\) then/g)?.length).toBe(2);
    expect(migration).toContain("Apenas administradores podem visualizar o impacto");
    expect(migration).toContain("Apenas administradores podem desfazer uma reunião");
    expect(migration).toContain("security definer\nset search_path = ''");
    expect(migration).toContain(
      "revoke all on function app_private.admin_undo_meeting(uuid) from public, anon, service_role",
    );
    expect(migration).not.toMatch(/grant execute[^;]+to (?:public|anon)/i);
  });

  test("rejeita uma reunião inexistente antes de qualquer mutação", () => {
    const missingMeeting = "raise exception 'Reunião % não encontrada.'";
    expect(migration.match(new RegExp(missingMeeting.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length).toBe(
      2,
    );
    expect(migration.indexOf(missingMeeting)).toBeLessThan(migration.indexOf("delete from public.meetings"));
  });

  test("permite excluir reunião não aplicada sem rollback de entidades", () => {
    expect(migration).toContain("if not v_applied then\n    v_allowed := true;");
    expect(migration).toContain("if v_applied then\n    -- Entidades existentes");
  });

  test("usa a PRIMEIRA aplicação da reunião como fronteira do rollback", () => {
    // GATE 9D.1 bloqueador 2: a fronteira precisa ser a primeira aplicação
    // (asc), não a mais recente — o undo desfaz TODOS os efeitos da reunião.
    expect(migration).toContain(
      "into v_target_application\n    from public.analysis_applications\n    where meeting_id = p_meeting_id\n    order by created_at asc, id asc\n    limit 1;",
    );
    expect(migration).toContain(
      "(later.created_at, later.id) >\n              (v_target_application.created_at, v_target_application.id)",
    );
    expect(migration).toContain("elsif v_has_later_application then");
    expect(migration).toContain("Existe uma aplicação posterior neste projeto.");
    expect(migration).toContain("else\n    v_allowed := true;");
  });

  test("bloqueia rollback ambíguo quando a mesma reunião tem múltiplas aplicações", () => {
    // GATE 9D.1 bloqueador 2 (parte 2): explícito e independente do check de
    // "aplicação posterior de outra reunião".
    expect(migration).toContain("v_multiple_applications boolean := false;");
    expect(migration).toContain(
      "select count(*) > 1\n      into v_multiple_applications\n    from public.analysis_applications\n    where meeting_id = p_meeting_id;",
    );
    expect(migration).toContain("elsif v_multiple_applications then");
    expect(migration).toContain("Esta reunião foi aplicada mais de uma vez; o rollback ficaria ambíguo.");
    // Precisa ser checado antes de "aplicação posterior" na cadeia elsif.
    expect(migration.indexOf("elsif v_multiple_applications then")).toBeLessThan(
      migration.indexOf("elsif v_has_later_application then"),
    );
  });

  test("bloqueia undo se uma entidade atualizada pela reunião foi alterada depois", () => {
    // GATE 9D.1 bloqueador 1: compara o estado ATUAL contra new_value, não
    // só se o snapshot é "suficiente" — snapshot suficiente e desatualizado
    // são problemas diferentes e precisam de mensagens diferentes.
    expect(migration).toContain("admin_undo_current_state_matches");
    expect(migration).toContain("for v_key in select jsonb_object_keys(p_new_value)");
    expect(migration).toContain("if not (v_current -> v_key is not distinct from p_new_value -> v_key) then");
    expect(migration).toContain("into v_entity_changed_after;");
    expect(migration).toContain("elsif v_entity_changed_after then");
    expect(migration).toContain(
      "Uma ou mais entidades atualizadas por esta reunião foram alteradas depois; desfazer sobrescreveria essa alteração posterior.",
    );
    // O check de "snapshot insuficiente" continua tendo prioridade sobre o
    // de "mudou depois" — são causas diferentes do mesmo bloqueio.
    expect(migration.indexOf("elsif v_unsafe_entity_history then")).toBeLessThan(
      migration.indexOf("elsif v_entity_changed_after then"),
    );
  });

  test("bloqueia undo se um ContextItem atualizado pela reunião foi alterado depois", () => {
    expect(migration).toContain("admin_undo_context_current_matches");
    expect(migration).toContain("return v_current_item is not distinct from p_new_item;");
    expect(migration).toContain("into v_context_changed_after;");
    expect(migration).toContain("elsif v_context_changed_after then");
    expect(migration).toContain(
      "Um ou mais itens de contexto atualizados por esta reunião foram alterados depois; desfazer sobrescreveria essa alteração posterior.",
    );
  });

  test("bloqueia contexto legado sem snapshot completo", () => {
    expect(migration).toContain("admin_undo_context_snapshot_is_sufficient");
    expect(migration).toContain("jsonb_typeof(p_previous -> 'item') = 'object'");
    expect(migration).toContain("O contexto legado não contém o ContextItem anterior completo");
  });

  test("restaura alterações em ordem reversa e trata decisions explicitamente", () => {
    for (const mentionType of ["updated", "resolved", "reopened", "superseded"]) {
      expect(migration).toContain(`'${mentionType}'`);
    }
    expect(migration).toContain("order by created_at desc, id desc");
    expect(migration).toContain("when 'decision' then\n          update public.decisions");
    expect(migration).toContain("delete from public.decisions d");
    expect(migration).toContain("and em.mention_type = 'created'");
  });

  test("apaga decisions por meeting_id além da menção created, sem apagar decisão só atualizada", () => {
    // GATE 9D.1 bloqueador 3.
    expect(migration).toContain(
      "delete from public.decisions d\n    where d.meeting_id = p_meeting_id\n       or exists (",
    );
    // O UPDATE de decision (para uma decisão já existente) nunca reatribui
    // meeting_id — é exatamente isso que garante que uma decisão antiga só
    // ATUALIZADA pela reunião não seja apagada pelo `d.meeting_id =
    // p_meeting_id` acima.
    const decisionUpdateBlock = migration.slice(
      migration.indexOf("when 'decision' then\n          update public.decisions"),
      migration.indexOf("end case;", migration.indexOf("when 'decision' then\n          update public.decisions")),
    );
    expect(decisionUpdateBlock).not.toContain("meeting_id =");

    // E do lado do app: o patch de update de decision não inclui meeting_id.
    // (a mesma frase "update && targetId" também aparece no fluxo de
    // context_item, por isso ancoramos a partir da seção de decisões.)
    const decisionsSection = meetingAnalysis.indexOf("/* ---------- decisões ---------- */");
    const decisionUpdateStart = meetingAnalysis.indexOf(
      'res.mode === "update" && res.targetId',
      decisionsSection,
    );
    const decisionUpdateInApp = meetingAnalysis.slice(
      decisionUpdateStart,
      meetingAnalysis.indexOf("mentions.push", decisionUpdateStart),
    );
    expect(decisionsSection).toBeGreaterThan(-1);
    expect(decisionUpdateInApp).not.toContain('patch["meeting_id"]');
  });

  test("devolve client_id e documenta a limitação do recálculo de estado derivado do cliente", () => {
    // GATE 9D.1 bloqueador 4: sem RPC SQL equivalente a recalculateClient(),
    // não inventamos a refatoração aqui — só expomos client_id pro chamador
    // futuro integrar, e documentamos a limitação explicitamente.
    expect(migration).toContain("'client_id', v_meeting.client_id,\n    'deleted', true,");
    expect(migration).toContain("NÃO recalcula o estado derivado do");
    expect(migration).toContain("recalculateClient() em src/lib/api.ts");
    expect(migration).toContain("não há RPC SQL equivalente");
  });

  test("restaura e remove somente ContextItems rastreáveis", () => {
    expect(migration).toContain("then v_previous_item else item end");
    expect(migration).toContain("v_item ->> 'source_meeting_id' = p_meeting_id::text");
    expect(migration).toContain("v_context_restored := v_context_restored + 1");
    expect(migration).toContain("v_context_removed := v_context_removed + 1");
    expect(migration).toContain("set last_meeting_id = v_previous_meeting_id");
  });

  test("preserva o ContextItem completo antes e depois da atualização", () => {
    expect(meetingAnalysis).toContain(
      "previous_value: { text: previousItem.text, list: key, item: previousItem }",
    );
    expect(meetingAnalysis).toContain("new_value: { text: nextItem.text, list: key, item: nextItem }");
    expect(projects).toContain('const embedding = obj["embedding"]');
    expect(projects).toContain("embedding: embedding as number[]");
  });
});
