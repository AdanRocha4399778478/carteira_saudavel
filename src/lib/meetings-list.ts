import { queryOptions } from "@tanstack/react-query";
import { logDbError, type MeetingsPage, type MeetingsPageParams } from "@/lib/api";
import { normalizeMeeting } from "@/lib/domain";
import { supabase } from "@/lib/supabase/client";

const MEETINGS_LIST_COLUMNS =
  "id, client_id, meeting_date, meeting_type, participants, executive_summary, satisfaction_score, value_score, has_measurable_result, main_pain, next_action, action_owner, action_deadline, explicit_complaint, continuity_doubt, low_client_adherence, missing_internal_owner, calculated_risk_score, calculated_risk_level, analysis_risk_level, created_at";

/**
 * Consulta exclusiva da listagem paginada de reuniões. Mantém os campos usados
 * pelos cards, pelos filtros de busca e pelo desempate de ordenação, sem trazer
 * o registro completo de cada reunião.
 */
export const meetingsListPageQuery = (params: MeetingsPageParams) =>
  queryOptions({
    queryKey: [
      "meetings",
      "page",
      "scoped",
      params.page,
      params.pageSize,
      params.clientId,
      params.meetingType,
      params.search,
    ],
    queryFn: async (): Promise<MeetingsPage> => {
      const from = (params.page - 1) * params.pageSize;
      let query = supabase
        .from("meetings")
        .select(MEETINGS_LIST_COLUMNS, { count: "exact" })
        .order("meeting_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, from + params.pageSize - 1);

      if (params.clientId) query = query.eq("client_id", params.clientId);
      if (params.meetingType) query = query.eq("meeting_type", params.meetingType);
      const term = params.search.trim();
      if (term) {
        const safe = term.replace(/[%,()]/g, " ").trim();
        if (safe)
          query = query.or(
            `executive_summary.ilike.%${safe}%,next_action.ilike.%${safe}%,main_pain.ilike.%${safe}%`,
          );
      }

      const res = await query;
      if (res.error) {
        logDbError("meetings", "select-page-scoped", res.error);
        throw new Error(res.error.message);
      }
      return {
        rows: ((res.data ?? []) as Record<string, unknown>[]).map(normalizeMeeting),
        total: res.count ?? 0,
      };
    },
  });
