import { supabase } from "@/integrations/supabase/client";
import type { HostTeam, Submission } from "@/lib/blind";
import { usePoll } from "./usePoll";

/** Host-only live feed: full team rows (incl. draft code) + submissions. */
export function useHostData(roomId: string | null, hostSecret: string | null, running: boolean) {
  const enabled = Boolean(roomId && hostSecret);

  const teamsPoll = usePoll<HostTeam[]>(
    async () => {
      if (!roomId || !hostSecret) return [];
      const { data } = await supabase.rpc("host_teams", {
        p_room_id: roomId,
        p_secret: hostSecret,
      });
      return (data ?? []) as HostTeam[];
    },
    [roomId, hostSecret],
    enabled,
    running ? 2500 : 6000,
    [],
  );

  const submissionsPoll = usePoll<Submission[]>(
    async () => {
      if (!roomId || !hostSecret) return [];
      const { data } = await supabase.rpc("host_submissions", {
        p_room_id: roomId,
        p_secret: hostSecret,
      });
      return (data ?? []) as Submission[];
    },
    [roomId, hostSecret],
    enabled,
    running ? 2500 : 8000,
    [],
  );

  return {
    teams: teamsPoll.data,
    submissions: submissionsPoll.data,
    refresh: () => {
      teamsPoll.refresh();
      submissionsPoll.refresh();
    },
  };
}
