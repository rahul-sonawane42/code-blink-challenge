import { supabase } from "@/integrations/supabase/client";
import { usePoll } from "./usePoll";

export interface SubmissionResult {
  status: string;
  code: string | null;
  char_count: number;
  reviewed_at: string | null;
}

const NONE: SubmissionResult = { status: "pending", code: null, char_count: 0, reviewed_at: null };

/**
 * Follows an end-of-turn submission until the host renders a verdict.
 * Pending/rejected codes never leave the server; the code only arrives
 * once the submission is marked correct (or revealed).
 */
export function useVerdict(
  submissionId: string | null,
  teamId: string | null,
  teamSecret: string | null,
) {
  const enabled = Boolean(submissionId && teamId && teamSecret);
  return usePoll<SubmissionResult>(
    async () => {
      if (!submissionId || !teamId || !teamSecret) return NONE;
      const { data } = await supabase.rpc("get_submission_result", {
        p_submission_id: submissionId,
        p_team_id: teamId,
        p_secret: teamSecret,
      });
      const row = Array.isArray(data) ? data[0] : undefined;
      return row ? (row as SubmissionResult) : NONE;
    },
    [submissionId, teamId, teamSecret],
    enabled,
    1300,
    NONE,
    submissionId,
  );
}
