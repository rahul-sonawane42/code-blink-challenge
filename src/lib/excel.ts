import type { HostTeam, Room, Submission } from "./blind";
import { formatClock } from "./blind";
import { buildXlsx, downloadXlsx } from "./xlsx";

function stamp(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export interface ExcelBundle {
  room: Room;
  teams: HostTeam[];
  submissions: Submission[];
  remaining: number | null;
}

/** Turns a room's team data into an .xlsx the host can archive. */
export function exportRoomToExcel(bundle: ExcelBundle) {
  const { room, teams, submissions, remaining } = bundle;

  // Build team rows — the main data the host cares about
  const teamRows = teams
    .filter((t) => t.accepted || t.status !== "pending")
    .map((t) => {
      // Find the team's latest correct or last submission code
      const teamSubs = submissions
        .filter((s) => s.team_id === t.id)
        .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
      const correct = teamSubs.find((s) => s.status === "correct");
      const latest = teamSubs[teamSubs.length - 1];
      const finalCode = correct?.code ?? latest?.code ?? t.draft_code ?? "";

      // Calculate time remaining for this team (if finished, compute from timestamps)
      let timeRemaining = "—";
      if (t.finished_at && room.started_at) {
        const elapsed = new Date(t.finished_at).getTime() - new Date(room.started_at).getTime();
        const left = Math.max(0, room.duration_seconds * 1000 - elapsed);
        timeRemaining = formatClock(left);
      } else if (remaining !== null) {
        timeRemaining = formatClock(remaining);
      }

      return [
        t.name,
        t.color ?? "—",
        t.lives,
        t.current_member,
        t.char_count,
        timeRemaining,
        correct ? "Solved" : t.status === "finished" ? "Finished" : t.status,
        finalCode,
      ];
    });

  downloadXlsx(
    buildXlsx([
      {
        name: "Teams",
        rows: [
          [
            "Team Name",
            "Color",
            "Lives Remaining",
            "Members Used",
            "Characters",
            "Time Remaining",
            "Result",
            "Code",
          ],
          ...teamRows,
        ],
      },
    ]),
    `code-blink-${room.code}-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}
