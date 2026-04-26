import { useEffect, useMemo, useState } from "react";

import {
  getMergeState,
  getMergeStatus,
  resolveMerge,
  startMerge,
  type MergeConflict,
  type MergeConflictType,
  type MergedCKState,
  type MergedEntry,
  type MergeResolutionChoice,
  type MergeState,
  type Resolution,
} from "../services/mergeApi";
import { getStoredSession } from "../services/auth";

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
  | "submitting"
  | "done"
  | "error";

type DraftResolution = {
  choice?: MergeResolutionChoice;
  custom_title?: string;
  custom_desc?: string;
};

type ConflictGroup = {
  type: MergeConflictType;
  label: string;
  shortLabel: string;
  description: string;
};

const CONFLICT_GROUPS: ConflictGroup[] = [
  {
    type: "duplicate_concept",
    label: "Duplicated Concepts",
    shortLabel: "Dup. concepts",
    description: "Concepts that describe nearly the same design direction.",
  },
  {
    type: "duplicate_knowledge",
    label: "Duplicated Knowledge",
    shortLabel: "Dup. knowledge",
    description: "Knowledge nodes that say almost the same thing.",
  },
  {
    type: "concept_rejected_by_knowledge",
    label: "Concept Rejected By Knowledge",
    shortLabel: "Concept vs knowledge",
    description: "A concept is challenged or constrained by knowledge from the other board.",
  },
  {
    type: "contradicting_concept",
    label: "Contradicting Concepts",
    shortLabel: "Contradictions",
    description: "Concepts that push the design in incompatible directions.",
  },
];

const CHOICE_LABELS: Record<MergeResolutionChoice, string> = {
  a: "Keep A",
  b: "Keep B",
  both: "Keep both",
  custom: "Create a new one",
};

export function MergeWorkspace({ onClose, onMergeComplete }: Props) {
  const session = getStoredSession();
  const sessionId = session?.id ?? "";

  const [phase, setPhase] = useState<Phase>("checking");
  const [statusMsg, setStatusMsg] = useState("");
  const [mergeState, setMergeState] = useState<MergeState | null>(null);
  const [draftResolutions, setDraftResolutions] = useState<Record<string, DraftResolution>>({});
  const [activeType, setActiveType] = useState<MergeConflictType>("duplicate_concept");
  const [activeConflictId, setActiveConflictId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionId) {
      setPhase("not_ready");
      setStatusMsg("No active session.");
      return;
    }

    getMergeStatus(sessionId)
      .then(async (status) => {
        if (!status.ready) {
          setPhase("not_ready");
          setStatusMsg(status.reason);
          return;
        }

        if (status.merge_id && status.status) {
          const state = await getMergeState(status.merge_id);
          hydrateFromState(state);
          return;
        }

        setStatusMsg(status.reason);
        void handleStart();
      })
      .catch((err: unknown) => {
        setPhase("error");
        setError(err instanceof Error ? err.message : "Failed to check merge status.");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydrateFromState = (state: MergeState) => {
    setMergeState(state);
    const nextDrafts: Record<string, DraftResolution> = {};
    for (const conflict of state.conflicts) {
      if (conflict.resolution?.choice) {
        nextDrafts[conflict.id] = {
          choice: conflict.resolution.choice,
          custom_title: conflict.resolution.custom_title ?? undefined,
          custom_desc: conflict.resolution.custom_desc ?? undefined,
        };
      } else {
        nextDrafts[conflict.id] = {};
      }
    }
    setDraftResolutions(nextDrafts);

    const firstType = CONFLICT_GROUPS.find((group) =>
      state.conflicts.some((conflict) => conflict.conflict_type === group.type),
    )?.type ?? "duplicate_concept";
    setActiveType(firstType);

    const firstConflict = state.conflicts.find((conflict) => conflict.conflict_type === firstType);
    setActiveConflictId(firstConflict?.id ?? state.conflicts[0]?.id ?? null);
    setPhase(state.status === "done" ? "done" : "conflict_review");
  };

  const handleStart = async () => {
    setPhase("starting");
    try {
      const state = await startMerge(sessionId);
      hydrateFromState(state);
    } catch (err: unknown) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Failed to start merge.");
    }
  };

  const groupedConflicts = useMemo(
    () =>
      CONFLICT_GROUPS.map((group) => ({
        ...group,
        conflicts: mergeState?.conflicts.filter((conflict) => conflict.conflict_type === group.type) ?? [],
      })),
    [mergeState],
  );

  const visibleConflicts = groupedConflicts.find((group) => group.type === activeType)?.conflicts ?? [];
  const activeConflict =
    visibleConflicts.find((conflict) => conflict.id === activeConflictId) ?? visibleConflicts[0] ?? null;

  useEffect(() => {
    if (!visibleConflicts.length) {
      return;
    }
    if (!activeConflict || activeConflict.conflict_type !== activeType) {
      setActiveConflictId(visibleConflicts[0].id);
    }
  }, [activeConflict, activeType, visibleConflicts]);

  const resolvedCount = useMemo(
    () =>
      mergeState?.conflicts.filter((conflict) =>
        isResolutionComplete(draftResolutions[conflict.id], conflict),
      ).length ?? 0,
    [draftResolutions, mergeState],
  );

  const totalConflicts = mergeState?.conflicts.length ?? 0;
  const allResolved = totalConflicts === 0 || resolvedCount === totalConflicts;

  const handleResolutionPatch = (conflictId: string, patch: Partial<DraftResolution>) => {
    setDraftResolutions((prev) => ({
      ...prev,
      [conflictId]: {
        ...prev[conflictId],
        ...patch,
      },
    }));
  };

  const handleSubmit = async () => {
    if (!mergeState) {
      return;
    }
    setPhase("submitting");
    try {
      const resolutions: Resolution[] = mergeState.conflicts.map((conflict) => {
        const resolution = draftResolutions[conflict.id];
        if (!isResolutionComplete(resolution, conflict) || !resolution.choice) {
          throw new Error("Resolve every conflict before creating the merged board.");
        }
        const fallbackTitle = conflict.suggested_resolution?.title?.trim() || undefined;
        const fallbackDesc = conflict.suggested_resolution?.desc?.trim() || undefined;
        return {
          conflict_id: conflict.id,
          choice: resolution.choice,
          custom_title: resolution.custom_title?.trim() || fallbackTitle,
          custom_desc: resolution.custom_desc?.trim() || fallbackDesc,
        };
      });
      const result = await resolveMerge(mergeState.id, resolutions);
      setMergeState(result);
      setPhase("done");
    } catch (err: unknown) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Failed to create merged board.");
    }
  };

  const handleApplyMerge = () => {
    if (mergeState?.merged_ck_state) {
      onMergeComplete(mergeState.merged_ck_state);
    }
    onClose();
  };

  const previewTitle = activeConflict
    ? getPreviewTitle(activeConflict, draftResolutions[activeConflict.id])
    : "No conflict selected";
  const previewDesc = activeConflict
    ? getPreviewDescription(activeConflict, draftResolutions[activeConflict.id])
    : "";

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
        {(phase === "checking" || phase === "starting" || phase === "submitting") && (
          <div className="ck-merge__spinner-wrap">
            <div className="ck-merge__spinner" />
            <p>
              {phase === "checking" && "Checking whether both collaborators are ready…"}
              {phase === "starting" && "Comparing both boards and asking the LLM to detect conflicts…"}
              {phase === "submitting" && "Creating the final merged CK board…"}
            </p>
          </div>
        )}

        {phase === "not_ready" && (
          <div className="ck-merge__state">
            <div className="ck-merge__icon">⚠</div>
            <p>{statusMsg}</p>
            <button className="ck-merge__btn ck-merge__btn--secondary" onClick={onClose}>Go back</button>
          </div>
        )}

        {phase === "conflict_review" && mergeState && (
          <div className="ck-merge__workspace">
            <div className="ck-merge__summary">
              <div>
                <div className="ck-merge__summary-title">Resolve merge conflicts</div>
                <div className="ck-merge__summary-copy">
                  The system already grouped conflicts for you. Choose a type, review each conflict, and decide whether to keep A, keep B, keep both, or write a new merged node.
                </div>
              </div>
              <div className="ck-merge__summary-stats">
                <span>{resolvedCount}/{totalConflicts} resolved</span>
              </div>
            </div>

            <div className="ck-merge__tabs">
              {groupedConflicts.map((group) => {
                const count = group.conflicts.length;
                return (
                  <button
                    key={group.type}
                    type="button"
                    className={`ck-merge__tab ${group.type === activeType ? "is-active" : ""}`}
                    onClick={() => {
                      setActiveType(group.type);
                      setActiveConflictId(group.conflicts[0]?.id ?? null);
                    }}
                    disabled={count === 0}
                  >
                    <span>{group.shortLabel}</span>
                    <strong>{count}</strong>
                  </button>
                );
              })}
            </div>

            {visibleConflicts.length === 0 ? (
              <div className="ck-merge__empty">
                <h3>No conflicts in this group</h3>
                <p>Pick another conflict type above or finish the merge if everything is already resolved.</p>
              </div>
            ) : (
              <div className="ck-merge__grid">
                <aside className="ck-merge__list">
                  <div className="ck-merge__list-title">
                    {CONFLICT_GROUPS.find((group) => group.type === activeType)?.label}
                  </div>
                  <div className="ck-merge__list-copy">
                    {CONFLICT_GROUPS.find((group) => group.type === activeType)?.description}
                  </div>
                  <div className="ck-merge__list-items">
                    {visibleConflicts.map((conflict, index) => {
                      const resolution = draftResolutions[conflict.id];
                      const resolved = isResolutionComplete(resolution, conflict);
                      return (
                        <button
                          key={conflict.id}
                          type="button"
                          className={`ck-merge__list-item ${conflict.id === activeConflict?.id ? "is-active" : ""}`}
                          onClick={() => setActiveConflictId(conflict.id)}
                        >
                          <div className="ck-merge__list-item-top">
                            <span>Conflict {index + 1}</span>
                            <span className={`ck-merge__status-dot ${resolved ? "is-resolved" : ""}`} />
                          </div>
                          <div className="ck-merge__list-item-title">
                            {conflict.node_a.title} vs {conflict.node_b.title}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                {activeConflict && (
                  <section className="ck-merge__detail">
                    <div className="ck-merge__detail-top">
                      <NodePanel title={`Person A · ${activeConflict.node_a.owner}`} node={activeConflict.node_a} />
                      <div className="ck-merge__description-card">
                        <div className="ck-merge__description-tag">
                          {formatConflictType(activeConflict.conflict_type)}
                        </div>
                        <div className="ck-merge__description-title">Conflict description</div>
                        <p>{activeConflict.explanation}</p>
                        <div className="ck-merge__arrow">↔</div>
                      </div>
                      <NodePanel title={`Person B · ${activeConflict.node_b.owner}`} node={activeConflict.node_b} />
                    </div>

                    <div className="ck-merge__decision-layout">
                      <div className="ck-merge__decision-card">
                        <div className="ck-merge__section-title">Discuss & decide</div>
                        <div className="ck-merge__choice-list">
                          {(["a", "b", "custom", "both"] as MergeResolutionChoice[]).map((choice) => (
                            <label key={choice} className="ck-merge__choice">
                              <input
                                type="radio"
                                checked={draftResolutions[activeConflict.id]?.choice === choice}
                                onChange={() =>
                                  handleResolutionPatch(activeConflict.id, {
                                    choice,
                                    ...(choice !== "custom"
                                      ? { custom_title: undefined, custom_desc: undefined }
                                      : {}),
                                  })
                                }
                              />
                              <span>{CHOICE_LABELS[choice]}</span>
                            </label>
                          ))}
                        </div>

                        {activeConflict.suggested_resolution && (
                          <div className="ck-merge__suggestion">
                            <div className="ck-merge__suggestion-title">Suggested solution</div>
                            <div className="ck-merge__suggestion-choice">
                              Recommended: {CHOICE_LABELS[activeConflict.suggested_resolution.choice ?? "custom"]}
                            </div>
                            {activeConflict.suggested_resolution.title && (
                              <div className="ck-merge__suggestion-preview">
                                {activeConflict.suggested_resolution.title}
                              </div>
                            )}
                            {activeConflict.suggested_resolution.rationale && (
                              <p>{activeConflict.suggested_resolution.rationale}</p>
                            )}
                          </div>
                        )}

                        {draftResolutions[activeConflict.id]?.choice === "custom" && (
                          <div className="ck-merge__custom-form">
                            <input
                              className="ck-merge__input"
                              value={draftResolutions[activeConflict.id]?.custom_title ?? ""}
                              onChange={(event) =>
                                handleResolutionPatch(activeConflict.id, {
                                  custom_title: event.target.value,
                                })
                              }
                              placeholder="New merged node title"
                            />
                            <textarea
                              className="ck-merge__textarea"
                              value={draftResolutions[activeConflict.id]?.custom_desc ?? ""}
                              onChange={(event) =>
                                handleResolutionPatch(activeConflict.id, {
                                  custom_desc: event.target.value,
                                })
                              }
                              placeholder="Describe the merged result"
                              rows={5}
                            />
                          </div>
                        )}
                      </div>

                      <div className="ck-merge__preview-card">
                        <div className="ck-merge__section-title">Current merged result</div>
                        <div className="ck-merge__preview-node">
                          <div className="ck-merge__preview-node-type">
                            {activeConflict.node_a.type === "knowledge" &&
                            activeConflict.node_b.type === "knowledge"
                              ? "Knowledge"
                              : "Concept"}
                          </div>
                          <div className="ck-merge__preview-node-title">{previewTitle}</div>
                          <div className="ck-merge__preview-node-desc">{previewDesc}</div>
                        </div>
                        <div className="ck-merge__plan">
                          <div className="ck-merge__plan-title">Merge plan</div>
                          <div className="ck-merge__plan-items">
                            {mergeState.conflicts.map((conflict) => {
                              const resolution = draftResolutions[conflict.id];
                              const isDone = isResolutionComplete(resolution, conflict);
                              return (
                                <div key={conflict.id} className="ck-merge__plan-item">
                                  <span>{formatConflictType(conflict.conflict_type)}</span>
                                  <strong>
                                    {isDone && resolution?.choice
                                      ? CHOICE_LABELS[resolution.choice]
                                      : "Pending"}
                                  </strong>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            )}

            <div className="ck-merge__actions">
              <button className="ck-merge__btn ck-merge__btn--secondary" onClick={onClose}>Cancel</button>
              <button
                className="ck-merge__btn ck-merge__btn--primary"
                onClick={handleSubmit}
                disabled={!allResolved}
              >
                Create merged board
              </button>
            </div>
          </div>
        )}

        {phase === "done" && mergeState?.merged_ck_state && (
          <div className="ck-merge__done">
            <div className="ck-merge__icon ck-merge__icon--success">✓</div>
            <h2>Merge complete</h2>
            <p>The merged CK board is ready. Review the result below, then apply it to your board.</p>
            <MergedBoardPreview mergedState={mergeState.merged_ck_state} />
            <div className="ck-merge__actions ck-merge__actions--done">
              <button className="ck-merge__btn ck-merge__btn--secondary" onClick={onClose}>Close</button>
              <button className="ck-merge__btn ck-merge__btn--primary" onClick={handleApplyMerge}>
                Apply merged board
              </button>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="ck-merge__state">
            <div className="ck-merge__icon">✕</div>
            <p>{error}</p>
            <button className="ck-merge__btn ck-merge__btn--secondary" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

interface NodePanelProps {
  title: string;
  node: MergeConflict["node_a"];
}

function NodePanel({ title, node }: NodePanelProps) {
  return (
    <div className={`ck-merge__node-card ck-merge__node-card--${node.type}`}>
      <div className="ck-merge__node-card-owner">{title}</div>
      <div className="ck-merge__node-card-id">{node.id}</div>
      <div className="ck-merge__node-card-title">{node.title}</div>
      {node.desc && <div className="ck-merge__node-card-desc">{node.desc}</div>}
      {node.validationStatus && (
        <div className={`ck-merge__node-card-status ck-merge__node-card-status--${node.validationStatus}`}>
          {node.validationStatus}
        </div>
      )}
    </div>
  );
}

function MergedBoardPreview({ mergedState }: { mergedState: MergedCKState }) {
  const concepts = mergedState.entries.filter((entry) => entry.type === "concept");
  const knowledge = mergedState.entries.filter((entry) => entry.type === "knowledge");

  return (
    <div className="ck-merge__result">
      <div className="ck-merge__result-summary">
        <span>{mergedState.summary?.concept_count ?? concepts.length} concepts</span>
        <span>{mergedState.summary?.knowledge_count ?? knowledge.length} knowledge nodes</span>
      </div>
      <div className="ck-merge__result-columns">
        <div className="ck-merge__result-column">
          <div className="ck-merge__section-title">Concepts</div>
          {concepts.map((entry) => (
            <MergedEntryCard key={entry.id} entry={entry} />
          ))}
        </div>
        <div className="ck-merge__result-column">
          <div className="ck-merge__section-title">Knowledge</div>
          {knowledge.map((entry) => (
            <MergedEntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MergedEntryCard({ entry }: { entry: MergedEntry }) {
  return (
    <div className={`ck-merge__entry ck-merge__entry--${entry.type}`}>
      <div className="ck-merge__entry-id">{entry.id}</div>
      <div className="ck-merge__entry-title">{entry.title}</div>
      {entry.desc && <div className="ck-merge__entry-desc">{entry.desc}</div>}
    </div>
  );
}

function isResolutionComplete(resolution: DraftResolution | undefined, conflict: MergeConflict) {
  if (!resolution?.choice) {
    return false;
  }
  if (resolution.choice !== "custom") {
    return true;
  }
  return Boolean(resolution.custom_title?.trim() || conflict.suggested_resolution?.title?.trim());
}

function formatConflictType(type: MergeConflictType) {
  return CONFLICT_GROUPS.find((group) => group.type === type)?.label ?? type;
}

function getPreviewTitle(conflict: MergeConflict, resolution: DraftResolution | undefined) {
  const suggested = conflict.suggested_resolution;
  switch (resolution?.choice) {
    case "a":
      return conflict.node_a.title;
    case "b":
      return conflict.node_b.title;
    case "both":
      return `${conflict.node_a.title} + ${conflict.node_b.title}`;
    case "custom":
      return resolution.custom_title?.trim() || suggested?.title?.trim() || "New merged node";
    default:
      return suggested?.title?.trim() || "Choose a resolution to preview the merged result";
  }
}

function getPreviewDescription(conflict: MergeConflict, resolution: DraftResolution | undefined) {
  const suggested = conflict.suggested_resolution;
  switch (resolution?.choice) {
    case "a":
      return conflict.node_a.desc || "Keep Person A's node as the final result.";
    case "b":
      return conflict.node_b.desc || "Keep Person B's node as the final result.";
    case "both":
      return "Keep both nodes in the merged board.";
    case "custom":
      return (
        resolution.custom_desc?.trim() ||
        suggested?.desc?.trim() ||
        "Create a refined merged node for the final board."
      );
    default:
      return suggested?.desc?.trim() || "The final merged result will appear here.";
  }
}
