/**
 * Shared domain types + localStorage persistence for the Blind Coding platform.
 *
 * Everything a participant machine needs to survive an accidental reload lives
 * in one JSON blob under a single key, written synchronously on every change.
 */

export const MAX_LIVES = 4;
export const TEAM_SIZE = 4;

export type RoomStatus = "lobby" | "running" | "ended";
export type TeamStatus = "joined" | "typing" | "finished";

export interface Room {
  id: string;
  code: string;
  problem_title: string;
  problem_statement: string;
  duration_seconds: number;
  status: RoomStatus;
  started_at: string | null;
}

export interface Team {
  id: string;
  room_id: string;
  name: string;
  status: TeamStatus;
  lives: number;
  current_member: number;
  char_count: number;
}

/** The full recoverable participant session. */
export interface BlindSession {
  roomCode: string;
  teamId: string;
  teamName: string;
  /** Hidden code typed so far. */
  code: string;
  /** Epoch ms when the round ends. null while in the lobby. */
  deadline: number | null;
  livesLeft: number;
  currentMember: number;
  revealed: boolean;
}

const KEY = "blind-coding:session:v1";

export function loadSession(): BlindSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BlindSession;
    if (!parsed.roomCode || !parsed.teamId) return null;
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
    /* quota / private mode — nothing we can do */
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

const HOST_KEY = "blind-coding:host-room:v1";
export const loadHostRoom = () =>
  typeof window === "undefined" ? null : window.localStorage.getItem(HOST_KEY);
export const saveHostRoom = (code: string) => window.localStorage.setItem(HOST_KEY, code);
export const clearHostRoom = () => window.localStorage.removeItem(HOST_KEY);

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