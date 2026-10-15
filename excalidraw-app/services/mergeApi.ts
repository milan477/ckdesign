import { getStoredUser } from "./auth";

const API_BASE = (import.meta.env.VITE_APP_AI_BACKEND as string) || "";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const user = getStoredUser();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (user?.token) {
    headers.Authorization = `Bearer ${user.token}`;
  }

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

export type MergeConflictType =
  | "duplicate_concept"
  | "duplicate_knowledge"
  | "concept_rejected_by_knowledge"
  | "contradicting_concept";

export type MergeResolutionChoice = "a" | "b" | "both" | "custom";

export interface MergeNodePayload {
  merge_ref: string;
  original_id: string;
  id: string;
  owner: string;
  type: "concept" | "knowledge";
  title: string;
  desc?: string;
  operation_rationale?: string;
  parent_ref?: string | null;
  source_parent_refs?: string[];
  validationStatus?: "undecided" | "approved" | "rejected";
}

export interface MergeSuggestedResolution {
  choice?: MergeResolutionChoice | null;
  title?: string | null;
  desc?: string | null;
  rationale?: string | null;
}

export interface MergeResolution {
  choice?: MergeResolutionChoice;
  custom_title?: string | null;
  custom_desc?: string | null;
}

export interface MergeConflict {
  id: string;
  conflict_type: MergeConflictType;
  step: number;
  node_a: MergeNodePayload;
  node_b: MergeNodePayload;
  explanation: string;
  suggested_resolution: MergeSuggestedResolution | null;
  resolution: MergeResolution | null;
}

export interface MergedEntry {
  id: string;
  type: "concept" | "knowledge";
  title: string;
  desc: string;
  operation_rationale: string;
  parent_id: string | null;
  source_parent_ids: string[];
  validation_status?: "undecided" | "approved" | "rejected";
}

export interface MergedCKState {
  entries: MergedEntry[];
  confirmedInitialConcept?: { title: string; requirements: string } | null;
  showLineOfThoughtArrows?: boolean;
  showNodeDescriptions?: boolean;
  savedAt: string;
  summary?: {
    total_entries: number;
    concept_count: number;
    knowledge_count: number;
    resolved_conflicts: number;
  };
}

export interface MergeState {
  id: string;
  session_id: string;
  status: "detecting" | "conflict_review" | "done";
  merged_ck_state: MergedCKState | null;
  conflicts: MergeConflict[];
}

export interface Resolution {
  conflict_id: string;
  choice: MergeResolutionChoice;
  custom_title?: string;
  custom_desc?: string;
}

export async function getMergeStatus(session_id: string) {
  return req<{ ready: boolean; reason: string; merge_id?: string; status?: string }>(
    "GET",
    `/merge/status/${session_id}`,
  );
}

export async function startMerge(session_id: string): Promise<MergeState> {
  return req("POST", "/merge/start", { session_id });
}

export async function resolveMerge(merge_id: string, resolutions: Resolution[]): Promise<MergeState> {
  return req("POST", "/merge/resolve", { merge_id, resolutions });
}

export async function getMergeState(merge_id: string): Promise<MergeState> {
  return req("GET", `/merge/state/${merge_id}`);
}
