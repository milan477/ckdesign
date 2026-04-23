import { getStoredUser } from "./auth";

const API_BASE = (import.meta.env.VITE_APP_AI_BACKEND as string) || "";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
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

export interface MergeConflict {
  id: string;
  conflict_type: "knowledge" | "concept";
  step: number;
  node_a: { id: string; title: string; desc?: string; validationStatus?: string; owner?: string };
  node_b: { id: string; title: string; desc?: string; validationStatus?: string; owner?: string };
  explanation: string;
  resolution: { choice: string; custom_text?: string } | null;
}

export interface MergeState {
  id: string;
  session_id: string;
  status: "detecting" | "conflict_review" | "restructuring" | "concept_review" | "done";
  merged_ck_state: unknown | null;
  conflicts: MergeConflict[];
}

export async function getMergeStatus(session_id: string) {
  return req<{ ready: boolean; reason: string; merge_id?: string; status?: string }>(
    "GET", `/merge/status/${session_id}`,
  );
}

export async function startMerge(session_id: string): Promise<MergeState & { conflicts: MergeConflict[] }> {
  return req("POST", "/merge/start", { session_id });
}

export async function resolveKnowledge(merge_id: string, resolutions: Resolution[]): Promise<MergeState> {
  return req("POST", "/merge/resolve-knowledge", { merge_id, resolutions });
}

export async function resolveConcepts(merge_id: string, resolutions: Resolution[]): Promise<MergeState> {
  return req("POST", "/merge/resolve-concepts", { merge_id, resolutions });
}

export async function getMergeState(merge_id: string): Promise<MergeState> {
  return req("GET", `/merge/state/${merge_id}`);
}

export interface Resolution {
  conflict_id: string;
  choice: "a" | "b" | "custom";
  custom_text?: string;
}
