import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Room, Team } from "@/lib/blind";

/** Live room record, kept in sync over the realtime socket. */
export function useRoom(code: string | null) {
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!code) {
      setRoom(null);
      setLoading(false);
      return;
    }
    let active = true;

    const load = async () => {
      const { data } = await supabase.from("rooms").select("*").eq("code", code).maybeSingle();
      if (!active) return;
      setRoom((data as Room | null) ?? null);
      setLoading(false);
    };
    void load();

    const channel = supabase
      .channel(`room-${code}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `code=eq.${code}` },
        (payload) => {
          if (payload.eventType === "DELETE") setRoom(null);
          else setRoom(payload.new as Room);
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [code]);

  return { room, loading };
}

/** Live team roster for a room. */
export function useTeams(roomId: string | null) {
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    if (!roomId) {
      setTeams([]);
      return;
    }
    let active = true;

    const load = async () => {
      const { data } = await supabase
        .from("teams")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true });
      if (active) setTeams((data as Team[] | null) ?? []);
    };
    void load();

    const channel = supabase
      .channel(`teams-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "teams", filter: `room_id=eq.${roomId}` },
        () => void load(),
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [roomId]);

  return teams;
}