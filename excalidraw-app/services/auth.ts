const STORAGE_USER = "ck_auth_user";
const STORAGE_SESSION = "ck_auth_session";

const API_BASE = (import.meta.env.VITE_APP_AI_BACKEND as string) || "";

export interface AuthUser {
  id: string;
  username: string;
  token: string;
}

export interface SessionInfo {
  id: string;
  session_code: string;
  initial_concept: string;
  requirements: string | null;
  status: string;
  role: string;
  created_at: string;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function readSessionValue<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      return JSON.parse(raw) as T;
    }

    // One-time migration from the old cross-tab storage. Removing the legacy
    // value is important: otherwise every tab can silently become the same user.
    const legacy = localStorage.getItem(key);
    if (!legacy) {
      return null;
    }
    sessionStorage.setItem(key, legacy);
    localStorage.removeItem(key);
    return JSON.parse(legacy) as T;
  } catch {
    return null;
  }
}

export function getStoredUser(): AuthUser | null {
  return readSessionValue<AuthUser>(STORAGE_USER);
}

export function storeUser(user: AuthUser): void {
  sessionStorage.setItem(STORAGE_USER, JSON.stringify(user));
  localStorage.removeItem(STORAGE_USER);
}

export function clearUser(): void {
  sessionStorage.removeItem(STORAGE_USER);
  sessionStorage.removeItem(STORAGE_SESSION);
  localStorage.removeItem(STORAGE_USER);
  localStorage.removeItem(STORAGE_SESSION);
}

export function getStoredSession(): SessionInfo | null {
  return readSessionValue<SessionInfo>(STORAGE_SESSION);
}

export function storeSession(session: SessionInfo): void {
  sessionStorage.setItem(STORAGE_SESSION, JSON.stringify(session));
  localStorage.removeItem(STORAGE_SESSION);
}

export function clearSession(): void {
  sessionStorage.removeItem(STORAGE_SESSION);
  localStorage.removeItem(STORAGE_SESSION);
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export async function signup(username: string, password?: string): Promise<AuthUser> {
  const data = await post<{ token: string; user_id: string; username: string }>("/auth/signup", {
    username,
    password: password || null,
  });
  const user: AuthUser = { id: data.user_id, username: data.username, token: data.token };
  storeUser(user);
  return user;
}

export async function login(username: string, password?: string): Promise<AuthUser> {
  const data = await post<{ token: string; user_id: string; username: string }>("/auth/login", {
    username,
    password: password || null,
  });
  const user: AuthUser = { id: data.user_id, username: data.username, token: data.token };
  storeUser(user);
  return user;
}
