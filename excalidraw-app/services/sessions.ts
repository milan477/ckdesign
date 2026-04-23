import { getStoredUser, storeSession, type SessionInfo } from "./auth";

const API_BASE = (import.meta.env.VITE_APP_AI_BACKEND as string) || "";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const user = getStoredUser();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (user?.token) headers["Authorization"] = `Bearer ${user.token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export async function createSession(
  initial_concept: string,
  requirements?: string,
): Promise<SessionInfo> {
  const session = await request<SessionInfo>("POST", "/sessions/create", {
    initial_concept,
    requirements: requirements || null,
  });
  storeSession(session);
  return session;
}

export async function joinSession(session_code: string): Promise<SessionInfo> {
  const session = await request<SessionInfo>("POST", "/sessions/join", {
    session_code: session_code.toUpperCase(),
  });
  storeSession(session);
  return session;
}

export async function getMySessions(): Promise<SessionInfo[]> {
  return request<SessionInfo[]>("GET", "/sessions/mine");
}

export async function saveBoard(
  session_id: string,
  elements: unknown[],
  ck_state: unknown,
  app_state: Record<string, unknown> = {},
): Promise<void> {
  await request("PUT", "/boards/save", { session_id, elements, ck_nodes: ck_state, app_state });
}

export async function pushBoard(
  session_id: string,
  elements: unknown[],
  ck_nodes: unknown,
  app_state: Record<string, unknown> = {},
): Promise<void> {
  await request("POST", "/boards/push", { session_id, elements, ck_nodes, app_state });
}

export async function loadBoard(
  session_id: string,
): Promise<{ elements: unknown[]; ck_nodes: unknown[]; app_state: Record<string, unknown> } | null> {
  return request("GET", `/boards/${session_id}`);
}
