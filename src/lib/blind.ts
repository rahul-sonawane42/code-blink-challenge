/**
 * Shared domain types + localStorage persistence for the Blind Coding platform.
 *
 * Everything a participant machine needs to survive an accidental reload lives
 * in one JSON blob under a single key, written synchronously on every change.
 */

/* ---------- Constants ---------- */

export const TEAM_SIZE = 4;

/** Default lives per team — overridden by `room.max_lives` at runtime. */
export const MAX_LIVES = 4;

/** Pastel palette the host assigns to each team. */
export const TEAM_COLORS = [
  "#8EE7C2", // mint
  "#F4B9D3", // pink
  "#F6C9A9", // peach
  "#C7B8F2", // lavender
  "#A9C7F2", // sky
  "#F4E0A2", // gold
  "#A2E3DC", // aqua
  "#F5B2A3", // salmon
] as const;

/* ---------- DB Row Types ---------- */

export type RoomStatus = "lobby" | "running" | "paused" | "ended";
export type TeamStatus = "pending" | "accepted" | "typing" | "submitted" | "finished" | "kicked";

export interface Room {
  id: string;
  code: string;
  problem_title: string;
  problem_statement: string;
  duration_seconds: number;
  max_lives: number;
  status: RoomStatus;
  started_at: string | null;
  ended_at: string | null;
  remaining_ms: number | null;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  room_id: string;
  name: string;
  status: TeamStatus;
  lives: number;
  lives_granted: number;
  current_member: number;
  char_count: number;
  color: string | null;
  accepted: boolean;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Host-only view of a team (includes draft code from team_drafts). */
export interface HostTeam extends Team {
  draft_code: string;
}

export interface Submission {
  id: string;
  team_id: string;
  member: number;
  code: string;
  status: "pending" | "correct" | "rejected" | "revealed";
  submitted_at: string;
  reviewed_at: string | null;
}

/* ---------- Session Types ---------- */

/** The full recoverable participant session. */
export interface BlindSession {
  roomCode: string;
  roomId: string;
  teamId: string;
  teamName: string;
  teamSecret: string;
  /** Hidden code typed so far. */
  code: string;
  /** Epoch ms when the round ends. null while in the lobby. */
  deadline: number | null;
  livesLeft: number;
  maxLives: number;
  currentMember: number;
  revealed: boolean;
  /** Team color assigned by host. */
  color: string | null;
  /** Whether the host has accepted this team. */
  accepted: boolean;
  /** Submission id currently awaiting verdict, if any. */
  pendingSubmissionId: string | null;
  /** Latest verdict kind to show overlay. */
  verdictKind: "success" | "lifelost" | null;
}

/** Host session data persisted in localStorage. */
export interface HostSession {
  roomCode: string;
  roomId: string;
  hostSecret: string;
}

/* ---------- localStorage: Player Session ---------- */

const KEY = "blind-coding:session:v2";

export function loadSession(): BlindSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BlindSession;
    if (!parsed.roomCode || !parsed.teamId || !parsed.teamSecret) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: BlindSession) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* quota / private mode */
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  // Also remove legacy key
  window.localStorage.removeItem("blind-coding:session:v1");
}

/* ---------- localStorage: Host Session ---------- */

const HOST_KEY = "blind-coding:host:v2";

export function loadHostSession(): HostSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(HOST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HostSession;
    if (!parsed.roomCode || !parsed.roomId || !parsed.hostSecret) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveHostSession(session: HostSession) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HOST_KEY, JSON.stringify(session));
  } catch {
    /* quota / private mode */
  }
}

export function clearHostSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(HOST_KEY);
  // Also remove legacy key
  window.localStorage.removeItem("blind-coding:host-room:v1");
}

/** @deprecated — kept for backward compatibility in old code paths. */
export const loadHostRoom = (): string | null => {
  const session = loadHostSession();
  return session?.roomCode ?? null;
};
export const saveHostRoom = (code: string) => {
  // Legacy — noop, use saveHostSession instead
  void code;
};
export const clearHostRoom = () => clearHostSession();

/* ---------- Helpers ---------- */

export function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}