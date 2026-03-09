export type CKNodeType = "concept" | "knowledge";

export type CKOperation =
  | "CreateConcept"
  | "ExpandConcept"
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
}

export interface CKOperationInput {
  operation: CKOperation;
  topic: string;
  focusEntry: CKEntryContext | null;
  history: CKEntryContext[];
}

export interface CKGeneratedEntry {
  id?: string;
  type: CKNodeType;
  title: string;
  desc: string;
  operationRationale: string;
  sourceKnowledgeIds?: string[];
}

export interface CKOperationResult {
  generatedEntry?: CKGeneratedEntry;
  generatedEntries?: CKGeneratedEntry[];
  reorderedIds?: string[];
  noveltyDecision?: {
    isNovel: boolean;
    rationale: string;
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

const normalizeGeneratedEntry = (
  entry: Record<string, unknown>,
): CKGeneratedEntry | undefined => {
  if (
    (entry.type !== "concept" && entry.type !== "knowledge") ||
    typeof entry.title !== "string" ||
    typeof entry.desc !== "string"
  ) {
    return undefined;
  }
  return {
    id: typeof entry.id === "string" ? entry.id : undefined,
    type: entry.type,
    title: entry.title,
    desc: entry.desc,
    operationRationale:
      typeof entry.operationRationale === "string"
        ? entry.operationRationale
        : "Generated via CK operation.",
    sourceKnowledgeIds: Array.isArray(entry.sourceKnowledgeIds)
      ? entry.sourceKnowledgeIds.filter(
          (id): id is string => typeof id === "string",
        )
      : undefined,
  };
};

const toBackendHistory = (history: CKEntryContext[]) =>
  history.map((entry) => ({
    id: entry.id,
    type: entry.type,
    title: entry.title,
    desc: entry.desc,
    operation_rationale: entry.operationRationale,
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

const normalizeRemoteResult = (payload: unknown): CKOperationResult | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;

  const dialogue = Array.isArray(data.dialogue)
    ? data.dialogue
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const obj = entry as Record<string, unknown>;
          if (
            (obj.speaker !== "concept-agent" &&
              obj.speaker !== "knowledge-agent") ||
            typeof obj.content !== "string"
          ) {
            return null;
          }
          return {
            speaker: obj.speaker,
            content: obj.content,
          } as CKAgentMessage;
        })
        .filter((entry): entry is CKAgentMessage => !!entry)
    : [];

  const generatedEntry =
    data.generatedEntry &&
    typeof data.generatedEntry === "object" &&
    data.generatedEntry !== null
      ? (() => {
          return normalizeGeneratedEntry(
            data.generatedEntry as Record<string, unknown>,
          );
        })()
      : undefined;

  const generatedEntries = Array.isArray(data.generatedEntries)
    ? data.generatedEntries
        .map((entry) =>
          entry && typeof entry === "object"
            ? normalizeGeneratedEntry(entry as Record<string, unknown>)
            : undefined,
        )
        .filter((entry): entry is CKGeneratedEntry => !!entry)
    : undefined;

  const reorderedIds = Array.isArray(data.reorderedIds)
    ? data.reorderedIds.filter((id): id is string => typeof id === "string")
    : undefined;

  const noveltyDecision =
    data.noveltyDecision &&
    typeof data.noveltyDecision === "object" &&
    data.noveltyDecision !== null
      ? (() => {
          const decision = data.noveltyDecision as Record<string, unknown>;
          if (
            typeof decision.isNovel !== "boolean" ||
            typeof decision.rationale !== "string"
          ) {
            return undefined;
          }
          return {
            isNovel: decision.isNovel,
            rationale: decision.rationale,
          };
        })()
      : undefined;

  if (
    !generatedEntry &&
    !(generatedEntries && generatedEntries.length) &&
    !reorderedIds &&
    !noveltyDecision &&
    dialogue.length === 0
  ) {
    return null;
  }

  return {
    generatedEntry,
    generatedEntries,
    reorderedIds,
    noveltyDecision,
    dialogue,
  };
};

const runRemoteOperation = async (
  input: CKOperationInput,
  base: string,
): Promise<CKOperationResult> => {
  let operateEndpointUnavailable = false;
  let operateResponse: Response | null = null;

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

    if (generatedEntries.length < 2) {
      throw new Error("Invalid response payload from /nodes/expand-concept.");
    }

    return {
      generatedEntries,
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
      reordered_knowledge?: Array<{ id?: string }>;
    };

    const reorderedIds =
      payload.reordered_knowledge
        ?.map((entry) => entry.id)
        .filter((id): id is string => !!id) || [];

    if (!reorderedIds.length) {
      throw new Error("Invalid response payload from /nodes/reorder.");
    }

    return {
      reorderedIds,
      dialogue: [],
    };
  }

  if (operateEndpointUnavailable) {
    throw getNotImplementedError(input.operation);
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
