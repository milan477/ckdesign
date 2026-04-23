import { useEffect, useState } from "react";

import {
  getMergeStatus,
  getMergeState,
  startMerge,
  resolveKnowledge,
  resolveConcepts,
  type MergeConflict,
  type MergeState,
  type Resolution,
} from "../services/mergeApi";
import { getStoredSession, storeSession } from "../services/auth";

import "./MergeWorkspace.scss";

interface Props {
  onClose: () => void;
  onMergeComplete: (mergedState: unknown) => void;
}

type Phase =
  | "checking"
  | "not_ready"
  | "starting"
  | "conflict_review"
  | "submitting_knowledge"
  | "concept_review"
  | "submitting_concepts"
  | "done"
  | "error";

export function MergeWorkspace({ onClose, onMergeComplete }: Props) {
  const session = getStoredSession();
  const sessionId = session?.id ?? "";

  const [phase, setPhase] = useState<Phase>("checking");
  const [statusMsg, setStatusMsg] = useState("");
  const [mergeState, setMergeState] = useState<MergeState | null>(null);
  const [knowledgeResolutions, setKnowledgeResolutions] = useState<Record<string, Resolution>>({});
  const [conceptResolutions, setConceptResolutions] = useState<Record<string, Resolution>>({});
  const [revalidated, setRevalidated] = useState<{ id: string; owner?: string; validationStatus: string }[]>([]);
  const [changeReport, setChangeReport] = useState("");
  const [error, setError] = useState("");

  // ── On mount: check status, auto-resume if merge in progress ──────────────
  useEffect(() => {
    if (!sessionId) { setPhase("not_ready"); setStatusMsg("No active session."); return; }
    getMergeStatus(sessionId)
      .then(async (s) => {
        if (!s.ready) { setPhase("not_ready"); setStatusMsg(s.reason); return; }
        if (s.merge_id && s.status && s.status !== "done") {
          const state = await getMergeState(s.merge_id);
          setMergeState(state);
          setPhase(state.status === "concept_review" ? "concept_review" : "conflict_review");
          initResolutions(state.conflicts);
        } else {
          setPhase("starting");
          setStatusMsg(s.reason);
          handleStart();
        }
      })
      .catch((e) => { setPhase("error"); setError(e.message); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initResolutions = (conflicts: MergeConflict[]) => {
    const kRes: Record<string, Resolution> = {};
    const cRes: Record<string, Resolution> = {};
    for (const c of conflicts) {
      const entry: Resolution = c.resolution
        ? { conflict_id: c.id, choice: c.resolution.choice as "a" | "b" | "custom", custom_text: c.resolution.custom_text }
        : { conflict_id: c.id, choice: "a" };
      if (c.step === 1) kRes[c.id] = entry;
      else cRes[c.id] = entry;
    }
    setKnowledgeResolutions(kRes);
    setConceptResolutions(cRes);
  };

  const handleStart = async () => {
    setPhase("starting");
    try {
      const state = await startMerge(sessionId);
      setMergeState(state);
      setPhase("conflict_review");
      initResolutions(state.conflicts);
    } catch (e: unknown) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Failed to start merge.");
    }
  };

  const handleSubmitKnowledge = async () => {
    if (!mergeState) return;
    setPhase("submitting_knowledge");
    try {
      const resolutions = Object.values(knowledgeResolutions);
      const result = await resolveKnowledge(mergeState.id, resolutions) as MergeState & {
        revalidated?: { id: string; owner?: string; validationStatus: string }[];
        concept_conflicts?: MergeConflict[];
        change_report?: string;
      };
      setMergeState({ ...result, conflicts: result.concept_conflicts ?? [] });
      setRevalidated(result.revalidated ?? []);
      setChangeReport(result.change_report ?? "");
      const cRes: Record<string, Resolution> = {};
      for (const c of result.concept_conflicts ?? []) {
        cRes[c.id] = { conflict_id: c.id, choice: "a" };
      }
      setConceptResolutions(cRes);
      setPhase("concept_review");
    } catch (e: unknown) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Failed to resolve knowledge conflicts.");
    }
  };

  const handleSubmitConcepts = async () => {
    if (!mergeState) return;
    setPhase("submitting_concepts");
    try {
      const resolutions = Object.values(conceptResolutions);
      const result = await resolveConcepts(mergeState.id, resolutions) as MergeState & {
        merged_ck_state: unknown;
      };
      setMergeState(result);
      setPhase("done");
    } catch (e: unknown) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Failed to resolve concept conflicts.");
    }
  };

  const handleApplyMerge = () => {
    if (mergeState?.merged_ck_state) {
      onMergeComplete(mergeState.merged_ck_state);
    }
    onClose();
  };

  const setKRes = (id: string, field: Partial<Resolution>) =>
    setKnowledgeResolutions((prev) => ({ ...prev, [id]: { ...prev[id], ...field } }));

  const setCRes = (id: string, field: Partial<Resolution>) =>
    setConceptResolutions((prev) => ({ ...prev, [id]: { ...prev[id], ...field } }));

  const knowledgeConflicts = mergeState?.conflicts.filter((c) => c.step === 1) ?? [];
  const conceptConflicts = mergeState?.conflicts.filter((c) => c.step === 2) ?? [];

  return (
    <div className="ck-merge">
      <header className="ck-merge__header">
        <div className="ck-merge__title">
          <span className="ck-merge__title-c">C</span>
          <span className="ck-merge__title-k">K</span>
          <span className="ck-merge__title-word"> Merge</span>
        </div>
        <button className="ck-merge__close" onClick={onClose} type="button">✕ Close</button>
      </header>

      <div className="ck-merge__body">

        {/* ── Checking / Starting ── */}
        {(phase === "checking" || phase === "starting") && (
          <div className="ck-merge__spinner-wrap">
            <div className="ck-merge__spinner" />
            <p>{phase === "checking" ? "Checking merge eligibility…" : "Analysing both boards with LLM…"}</p>
          </div>
        )}

        {/* ── Not ready ── */}
        {phase === "not_ready" && (
          <div className="ck-merge__not-ready">
            <div className="ck-merge__icon">⚠</div>
            <p>{statusMsg}</p>
            <button className="ck-merge__btn ck-merge__btn--secondary" onClick={onClose}>Go back</button>
          </div>
        )}

        {/* ── Knowledge conflict review ── */}
        {phase === "conflict_review" && (
          <>
            <div className="ck-merge__phase-title">
              Step 1 of 2 — Resolve knowledge conflicts
            </div>
            {knowledgeConflicts.length === 0 ? (
              <p className="ck-merge__no-conflicts">No knowledge conflicts found. Click Continue.</p>
            ) : (
              <div className="ck-merge__conflicts">
                {knowledgeConflicts.map((c) => (
                  <ConflictCard
                    key={c.id}
                    conflict={c}
                    resolution={knowledgeResolutions[c.id] ?? { conflict_id: c.id, choice: "a" }}
                    onResolution={(f) => setKRes(c.id, f)}
                  />
                ))}
              </div>
            )}
            <div className="ck-merge__actions">
              <button className="ck-merge__btn ck-merge__btn--primary" onClick={handleSubmitKnowledge}>
                Continue →
              </button>
            </div>
          </>
        )}

        {/* ── Restructuring / revalidating ── */}
        {phase === "submitting_knowledge" && (
          <div className="ck-merge__spinner-wrap">
            <div className="ck-merge__spinner" />
            <p>LLM is restructuring knowledge and re-validating concepts…</p>
          </div>
        )}

        {/* ── Concept conflict review ── */}
        {phase === "concept_review" && (
          <>
            <div className="ck-merge__phase-title">
              Step 2 of 2 — Resolve concept conflicts
            </div>
            {changeReport && (
              <details className="ck-merge__change-report">
                <summary>Knowledge restructure report</summary>
                <p className="ck-merge__change-report-body">{changeReport}</p>
              </details>
            )}
            {revalidated.length > 0 && (
              <details className="ck-merge__revalidated">
                <summary>Re-validation results ({revalidated.length} concepts updated)</summary>
                <div className="ck-merge__revalidated-list">
                  {revalidated.map((r) => (
                    <span key={r.id} className={`ck-merge__revalidated-pill ck-merge__revalidated-pill--${r.validationStatus}`}>
                      {r.owner ? `${r.owner} · ` : ""}{r.id}: {r.validationStatus}
                    </span>
                  ))}
                </div>
              </details>
            )}
            {conceptConflicts.length === 0 ? (
              <p className="ck-merge__no-conflicts">No concept conflicts found. Click Finish.</p>
            ) : (
              <div className="ck-merge__conflicts">
                {conceptConflicts.map((c) => (
                  <ConflictCard
                    key={c.id}
                    conflict={c}
                    resolution={conceptResolutions[c.id] ?? { conflict_id: c.id, choice: "a" }}
                    onResolution={(f) => setCRes(c.id, f)}
                    isConceptConflict
                  />
                ))}
              </div>
            )}
            <div className="ck-merge__actions">
              <button className="ck-merge__btn ck-merge__btn--primary" onClick={handleSubmitConcepts}>
                Finish merge →
              </button>
            </div>
          </>
        )}

        {/* ── Finalising ── */}
        {phase === "submitting_concepts" && (
          <div className="ck-merge__spinner-wrap">
            <div className="ck-merge__spinner" />
            <p>Assembling final merged board…</p>
          </div>
        )}

        {/* ── Done ── */}
        {phase === "done" && (
          <div className="ck-merge__done">
            <div className="ck-merge__icon ck-merge__icon--success">✓</div>
            <h2>Merge complete</h2>
            <p>The merged CK board is ready. Apply it to replace your current board.</p>
            <button className="ck-merge__btn ck-merge__btn--primary" onClick={handleApplyMerge}>
              Apply merged board
            </button>
          </div>
        )}

        {/* ── Error ── */}
        {phase === "error" && (
          <div className="ck-merge__error">
            <div className="ck-merge__icon">✕</div>
            <p>{error}</p>
            <button className="ck-merge__btn ck-merge__btn--secondary" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Conflict Card ─────────────────────────────────────────────────────────

interface ConflictCardProps {
  conflict: MergeConflict;
  resolution: Resolution;
  onResolution: (patch: Partial<Resolution>) => void;
  isConceptConflict?: boolean;
}

function ConflictCard({ conflict, resolution, onResolution, isConceptConflict }: ConflictCardProps) {
  return (
    <div className="ck-conflict-card">
      <div className="ck-conflict-card__explanation">
        <span className="ck-conflict-card__tag">{isConceptConflict ? "Concept clash" : "Knowledge clash"}</span>
        {conflict.explanation}
      </div>
      <div className="ck-conflict-card__nodes">
        <NodeChoice
          label={conflict.node_a.owner ?? "Board A"}
          node={conflict.node_a}
          selected={resolution.choice === "a"}
          onSelect={() => onResolution({ choice: "a", custom_text: undefined })}
        />
        <div className="ck-conflict-card__vs">vs</div>
        <NodeChoice
          label={conflict.node_b.owner ?? "Board B"}
          node={conflict.node_b}
          selected={resolution.choice === "b"}
          onSelect={() => onResolution({ choice: "b", custom_text: undefined })}
        />
      </div>
      <div className="ck-conflict-card__custom-row">
        <label className="ck-conflict-card__custom-label">
          <input
            type="radio"
            checked={resolution.choice === "custom"}
            onChange={() => onResolution({ choice: "custom" })}
          />
          Write a custom resolution
        </label>
        {resolution.choice === "custom" && (
          <textarea
            className="ck-conflict-card__custom-input"
            value={resolution.custom_text ?? ""}
            onChange={(e) => onResolution({ custom_text: e.target.value })}
            placeholder="Describe the resolved version…"
            rows={3}
          />
        )}
      </div>
    </div>
  );
}

interface NodeChoiceProps {
  label: string;
  node: { id: string; title: string; desc?: string; validationStatus?: string };
  selected: boolean;
  onSelect: () => void;
}

function NodeChoice({ label, node, selected, onSelect }: NodeChoiceProps) {
  return (
    <button
      type="button"
      className={`ck-node-choice ${selected ? "is-selected" : ""}`}
      onClick={onSelect}
    >
      <div className="ck-node-choice__label">{label} · {node.id}</div>
      <div className="ck-node-choice__title">{node.title}</div>
      {node.desc && <div className="ck-node-choice__desc">{node.desc}</div>}
      {node.validationStatus && (
        <div className={`ck-node-choice__vstatus ck-node-choice__vstatus--${node.validationStatus}`}>
          {node.validationStatus}
        </div>
      )}
    </button>
  );
}
