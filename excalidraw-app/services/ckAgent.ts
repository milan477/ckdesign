export type CKNodeType = "concept" | "knowledge";

export type CKOperation =
  | "CreateConcept"
  | "ExpandConcept"
  | "ExpandKnowledge"
  | "ReorderConcept"
  | "DecideNovelConcept"
  | "CreateKnowledge"
  | "ReorderKnowledge"
  | "ValidateConcept";

export type CKAgentSpeaker = "concept-agent" | "knowledge-agent";

export interface CKAgentMessage {
  speaker: CKAgentSpeaker;
  content: string;
}

export interface CKEntryContext {
  id: string;
  type: CKNodeType;
  title: string;
  desc: string;
  operationRationale: string;
  parentId: string | null;
  sourceParentIds?: string[];
}

export interface CKOperationInput {
  operation: CKOperation;
  topic: string;
  focusEntry: CKEntryContext | null;
  history: CKEntryContext[];
  expandCount?: number;
}

export interface CKGeneratedEntry {
  id?: string;
  type: CKNodeType;
  title: string;
  desc: string;
  operationRationale: string;
  sourceKnowledgeIds?: string[];
}

export interface CKNoveltyScores {
  novelty: number;
  feasibility: number;
  usefulness: number;
  clarity: number;
}

export interface CKReorderedKnowledgeEntry {
  id: string;
  type: "knowledge";
  title: string;
  desc: string;
  operationRationale: string;
  parentId: string | null;
  sourceParentIds: string[];
}

export interface CKKnowledgeReorderPatch {
  reorderedKnowledge: CKReorderedKnowledgeEntry[];
  removedKnowledgeIds: string[];
  redirectedIds: Record<string, string>;
  rationale: string;
}

export interface CKOperationResult {
  generatedEntry?: CKGeneratedEntry;
  generatedEntries?: CKGeneratedEntry[];
  reorderedIds?: string[];
  reorderPatch?: CKKnowledgeReorderPatch;
  validationDecision?: {
    conceptId: string;
    isValid: boolean;
    rationale: string;
  };
  noveltyDecision?: {
    selectedConceptId: string;
    rationale: string;
    scores?: CKNoveltyScores;
  };
  dialogue: CKAgentMessage[];
}

const NOT_IMPLEMENTED_STATUS = new Set([404, 405, 501]);

const isNotImplementedStatus = (status: number) =>
  NOT_IMPLEMENTED_STATUS.has(status);

const getNotImplementedError = (operation: CKOperation) =>
  new Error(`${operation} is not implemented on backend.`);

const stripConceptIdPrefix = (text: string) =>
  text.replace(/^\s*C\d+\s*:\s*/i, "").trim();

const parseConceptDescriptionPayload = (text: string) => {
  const normalized = text.replace(/\r/g, "").trim();
  const withoutBold = normalized.replace(/\*\*/g, "");

  const titleMatch = withoutBold.match(/concept\s*title\s*:\s*([^\n]+)/i);
  const descMatch = withoutBold.match(
    /concept\s*description\s*:\s*([\s\S]*)$/i,
  );

  const parsedTitle = titleMatch?.[1]?.trim() || "";
  const parsedDesc = descMatch?.[1]?.trim() || "";

  return { parsedTitle, parsedDesc };
};

const toBackendHistory = (history: CKEntryContext[]) =>
  history.map((entry) => ({
    id: entry.id,
    type: entry.type,
    title: entry.title,
    desc: entry.desc,
    operation_rationale: entry.operationRationale,
    parent_id: entry.parentId,
    source_parent_ids: entry.sourceParentIds || [],
  }));

const readResponseError = async (response: Response) => {
  try {
    const body = (await response.json()) as { detail?: string };
    if (typeof body?.detail === "string" && body.detail.trim()) {
      return body.detail;
    }
  } catch {
    // Ignore parse errors and use status text fallback.
  }
  return response.statusText || `HTTP ${response.status}`;
};

const runRemoteOperation = async (
  input: CKOperationInput,
  base: string,
): Promise<CKOperationResult> => {
  // try {
  //   operateResponse = await fetch(`${base}/v1/ai/ck/operate`, {
  //     method: "POST",
  //     headers: {
  //       Accept: "application/json",
  //       "Content-Type": "application/json",
  //     },
  //     body: JSON.stringify(input),
  //   });
  // } catch {
  //   operateEndpointUnavailable = true;
  // }

  // if (operateResponse) {
  //   if (operateResponse.ok) {
  //     const payload = (await operateResponse.json()) as unknown;
  //     const normalized = normalizeRemoteResult(payload);
  //     if (!normalized) {
  //       throw new Error("Invalid response payload from /v1/ai/ck/operate.");
  //     }
  //     return normalized;
  //   }

  //   if (isNotImplementedStatus(operateResponse.status)) {
  //     operateEndpointUnavailable = true;
  //   } else {
  //     const message = await readResponseError(operateResponse);
  //     throw new Error(
  //       `Backend /v1/ai/ck/operate failed (${operateResponse.status}): ${message}`,
  //     );
  //   }
  // }

  if (input.operation === "CreateConcept") {
    const response = await fetch(`${base}/nodes/create-concept`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: input.topic,
        ck_history: toBackendHistory(input.history),
        focus_entry_id: input.focusEntry?.id ?? null,
        num_entries: input.expandCount,
      }),
    });

    if (!response.ok) {
      if (isNotImplementedStatus(response.status)) {
        throw getNotImplementedError(input.operation);
      }
      const message = await readResponseError(response);
      throw new Error(
        `Backend /nodes/create-concept failed (${response.status}): ${message}`,
      );
    }

    const payload = (await response.json()) as {
      concept?: {
        id?: string;
        type?: string;
        title?: string;
        desc?: string;
        operation_rationale?: string;
      };
      source_knowledge_ids?: string[];
    };

    if (
      !payload.concept ||
      payload.concept.type !== "concept" ||
      typeof payload.concept.title !== "string" ||
      typeof payload.concept.desc !== "string"
    ) {
      throw new Error("Invalid response payload from /nodes/create-concept.");
    }

    const rawTitle = payload.concept.title;
    const rawDesc = payload.concept.desc;
    const parsed = parseConceptDescriptionPayload(rawDesc);
    const normalizedTitle = stripConceptIdPrefix(
      parsed.parsedTitle || rawTitle,
    );
    const normalizedDesc = parsed.parsedDesc || rawDesc;

    return {
      generatedEntry: {
        id: payload.concept.id,
        type: "concept",
        title: normalizedTitle,
        desc: normalizedDesc,
        operationRationale:
          payload.concept.operation_rationale ||
          "Generated via single K->C (k_to_c) operation.",
        sourceKnowledgeIds:
          payload.source_knowledge_ids?.filter(
            (id) => typeof id === "string",
          ) || [],
      },
      dialogue: [],
    };
  }

  if (input.operation === "CreateKnowledge") {
    const response = await fetch(`${base}/nodes/create-knowledge`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: input.topic,
        ck_history: toBackendHistory(input.history),
        focus_entry_id: input.focusEntry?.id ?? null,
        num_entries: input.expandCount,
      }),
    });

    if (!response.ok) {
      if (isNotImplementedStatus(response.status)) {
        throw getNotImplementedError(input.operation);
      }
      const message = await readResponseError(response);
      throw new Error(
        `Backend /nodes/create-knowledge failed (${response.status}): ${message}`,
      );
    }

    const payload = (await response.json()) as {
      knowledge?: {
        id?: string;
        type?: string;
        title?: string;
        desc?: string;
        operation_rationale?: string;
      };
      source_concept_id?: string;
    };

    if (
      !payload.knowledge ||
      payload.knowledge.type !== "knowledge" ||
      typeof payload.knowledge.title !== "string" ||
      typeof payload.knowledge.desc !== "string"
    ) {
      throw new Error("Invalid response payload from /nodes/create-knowledge.");
    }

    return {
      generatedEntry: {
        id: payload.knowledge.id,
        type: "knowledge",
        title: payload.knowledge.title,
        desc: payload.knowledge.desc,
        operationRationale:
          payload.knowledge.operation_rationale ||
          "Generated via single C->K (CreateKnowledge) operation.",
      },
      dialogue: [],
    };
  }

  if (input.operation === "ExpandConcept") {
    const response = await fetch(`${base}/nodes/expand-concept`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: input.topic,
        ck_history: toBackendHistory(input.history),
        focus_entry_id: input.focusEntry?.id ?? null,
        num_entries: input.expandCount,
      }),
    });

    if (!response.ok) {
      if (isNotImplementedStatus(response.status)) {
        throw getNotImplementedError(input.operation);
      }
      const message = await readResponseError(response);
      throw new Error(
        `Backend /nodes/expand-concept failed (${response.status}): ${message}`,
      );
    }

    const payload = (await response.json()) as {
      concepts?: Array<{
        id?: string;
        type?: string;
        title?: string;
        desc?: string;
        operation_rationale?: string;
      }>;
    };

    const generatedEntries: CKGeneratedEntry[] = [];
    for (const concept of payload.concepts || []) {
      if (
        concept.type !== "concept" ||
        typeof concept.title !== "string" ||
        typeof concept.desc !== "string"
      ) {
        continue;
      }

      const parsed = parseConceptDescriptionPayload(concept.desc);
      const normalizedTitle = stripConceptIdPrefix(
        parsed.parsedTitle || concept.title,
      );
      const normalizedDesc = parsed.parsedDesc || concept.desc;

      generatedEntries.push({
        id: concept.id,
        type: "concept",
        title: normalizedTitle,
        desc: normalizedDesc,
        operationRationale:
          concept.operation_rationale ||
          "Generated via ExpandConcept (C->C) operation.",
      });
    }

    if (!generatedEntries.length || generatedEntries.length > 5) {
      throw new Error("Invalid response payload from /nodes/expand-concept.");
    }

    return {
      generatedEntries,
      dialogue: [],
    };
  }

  if (input.operation === "DecideNovelConcept") {
    const response = await fetch(`${base}/nodes/decide-novel-concept`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: input.topic,
        ck_history: toBackendHistory(input.history),
      }),
    });

    if (!response.ok) {
      if (isNotImplementedStatus(response.status)) {
        throw getNotImplementedError(input.operation);
      }
      const message = await readResponseError(response);
      throw new Error(
        `Backend /nodes/decide-novel-concept failed (${response.status}): ${message}`,
      );
    }

    const payload = (await response.json()) as {
      selected_concept_id?: string;
      rationale?: string;
      scores?: {
        novelty?: number;
        feasibility?: number;
        usefulness?: number;
        clarity?: number;
      };
    };

    if (
      typeof payload.selected_concept_id !== "string" ||
      !payload.selected_concept_id.trim() ||
      typeof payload.rationale !== "string"
    ) {
      throw new Error(
        "Invalid response payload from /nodes/decide-novel-concept.",
      );
    }

    const scores =
      payload.scores &&
      typeof payload.scores.novelty === "number" &&
      typeof payload.scores.feasibility === "number" &&
      typeof payload.scores.usefulness === "number" &&
      typeof payload.scores.clarity === "number"
        ? {
            novelty: payload.scores.novelty,
            feasibility: payload.scores.feasibility,
            usefulness: payload.scores.usefulness,
            clarity: payload.scores.clarity,
          }
        : undefined;

    return {
      noveltyDecision: {
        selectedConceptId: payload.selected_concept_id,
        rationale: payload.rationale,
        scores,
      },
      dialogue: [],
    };
  }

  if (input.operation === "ReorderKnowledge") {
    const response = await fetch(`${base}/nodes/reorder`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: input.topic,
        ck_history: toBackendHistory(input.history),
      }),
    });

    if (!response.ok) {
      if (isNotImplementedStatus(response.status)) {
        throw getNotImplementedError(input.operation);
      }
      const message = await readResponseError(response);
      throw new Error(
        `Backend /nodes/reorder failed (${response.status}): ${message}`,
      );
    }

    const payload = (await response.json()) as {
      reordered_knowledge?: Array<{
        id?: string;
        type?: string;
        title?: string;
        desc?: string;
        operation_rationale?: string;
        parent_id?: string | null;
        source_parent_ids?: string[];
      }>;
      removed_knowledge_ids?: string[];
      redirected_ids?: Record<string, string>;
      rationale?: string;
    };

    const reorderedKnowledge =
      payload.reordered_knowledge?.reduce<CKReorderedKnowledgeEntry[]>(
        (entries, entry) => {
          if (
            entry.type !== "knowledge" ||
            typeof entry.id !== "string" ||
            !entry.id.trim() ||
            typeof entry.title !== "string" ||
            typeof entry.desc !== "string"
          ) {
            return entries;
          }

          entries.push({
            id: entry.id,
            type: "knowledge",
            title: entry.title,
            desc: entry.desc,
            operationRationale:
              entry.operation_rationale ||
              "Reordered based on K-space optimization.",
            parentId:
              typeof entry.parent_id === "string" && entry.parent_id.trim()
                ? entry.parent_id
                : null,
            sourceParentIds:
              entry.source_parent_ids?.filter(
                (id): id is string => typeof id === "string" && !!id.trim(),
              ) || [],
          });
          return entries;
        },
        [],
      ) || [];

    const reorderedIds = reorderedKnowledge.map((entry) => entry.id);

    if (!reorderedIds.length) {
      throw new Error("Invalid response payload from /nodes/reorder.");
    }

    return {
      reorderedIds,
      reorderPatch: {
        reorderedKnowledge,
        removedKnowledgeIds:
          payload.removed_knowledge_ids?.filter(
            (id): id is string => typeof id === "string" && !!id.trim(),
          ) || [],
        redirectedIds: Object.fromEntries(
          Object.entries(payload.redirected_ids || {}).filter(
            ([sourceId, targetId]) =>
              !!sourceId.trim() &&
              typeof targetId === "string" &&
              !!targetId.trim(),
          ),
        ),
        rationale:
          payload.rationale?.trim() ||
          "Knowledge entries were reordered for a cleaner K-space structure.",
      },
      dialogue: [],
    };
  }

  if (input.operation === "ValidateConcept") {
    const response = await fetch(`${base}/nodes/validate-concept`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: input.topic,
        ck_history: toBackendHistory(input.history),
        focus_entry_id: input.focusEntry?.id ?? null,
      }),
    });

    if (!response.ok) {
      if (isNotImplementedStatus(response.status)) {
        throw getNotImplementedError(input.operation);
      }
      const message = await readResponseError(response);
      throw new Error(
        `Backend /nodes/validate-concept failed (${response.status}): ${message}`,
      );
    }

    const payload = (await response.json()) as {
      concept_id?: string;
      is_valid?: boolean;
      rationale?: string;
    };

    if (
      typeof payload.concept_id !== "string" ||
      !payload.concept_id.trim() ||
      typeof payload.is_valid !== "boolean" ||
      typeof payload.rationale !== "string"
    ) {
      throw new Error("Invalid response payload from /nodes/validate-concept.");
    }

    return {
      validationDecision: {
        conceptId: payload.concept_id,
        isValid: payload.is_valid,
        rationale: payload.rationale,
      },
      dialogue: [],
    };
  }

  if (input.operation === "ExpandKnowledge") {
    const response = await fetch(`${base}/nodes/expand-knowledge`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: input.topic,
        ck_history: toBackendHistory(input.history),
        focus_entry_id: input.focusEntry?.id ?? null,
        num_entries: input.expandCount,
      }),
    });

    if (!response.ok) {
      if (isNotImplementedStatus(response.status)) {
        throw getNotImplementedError(input.operation);
      }
      const message = await readResponseError(response);
      throw new Error(
        `Backend /nodes/expand-knowledge failed (${response.status}): ${message}`,
      );
    }

    const payload = (await response.json()) as {
      knowledges?: Array<{
        id?: string;
        type?: string;
        title?: string;
        desc?: string;
        operation_rationale?: string;
      }>;
    };

    const generatedEntries: CKGeneratedEntry[] = [];
    for (const knowledge of payload.knowledges || []) {
      if (
        knowledge.type !== "knowledge" ||
        typeof knowledge.title !== "string" ||
        typeof knowledge.desc !== "string"
      ) {
        continue;
      }
      generatedEntries.push({
        id: knowledge.id,
        type: "knowledge",
        title: knowledge.title,
        desc: knowledge.desc,
        operationRationale:
          knowledge.operation_rationale ||
          "Generated via ExpandKnowledge (K->K) operation.",
      });
    }

    if (!generatedEntries.length || generatedEntries.length > 5) {
      throw new Error("Invalid response payload from /nodes/expand-knowledge.");
    }

    return {
      generatedEntries,
      dialogue: [],
    };
  }

  throw new Error(`Unsupported operation: ${input.operation}`);
};

export const runCKOperation = async (
  input: CKOperationInput,
): Promise<CKOperationResult> => {
  const backend = import.meta.env.VITE_APP_AI_BACKEND?.trim();
  if (!backend) {
    throw new Error(
      "VITE_APP_AI_BACKEND is not configured. Configure frontend env to use backend actions.",
    );
  }
  const base = backend.replace(/\/$/, "");
  return runRemoteOperation(input, base);
};
