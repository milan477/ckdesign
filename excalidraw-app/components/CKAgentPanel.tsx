import { useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/excalidraw";
import { FONT_FAMILY } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import {
  runCKOperation,
  placeCKConcept,
  placeCKKnowledge,
  type CKConceptReorderPatch,
  type CKEntryContext,
  type CKKnowledgeReorderPatch,
  type CKNodeType,
  type CKOperation,
} from "../services/ckAgent";
import { getStoredSession } from "../services/auth";
import { loadBoard, pushBoard } from "../services/sessions";
import { LocalData } from "../data/LocalData";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";

const NODE_WIDTH = 320;
const NODE_HEIGHT = 160;
const HORIZONTAL_GAP = 430;
const VERTICAL_GAP = 220;
const CONCEPT_TREE_LEVEL_GAP = 320;
const CONCEPT_TREE_SIBLING_GAP = 520;
const DIVIDER_X = 800;
const CONCEPT_COLUMN_X = DIVIDER_X - HORIZONTAL_GAP / 2 - NODE_WIDTH / 2;
const KNOWLEDGE_COLUMN_X = DIVIDER_X + HORIZONTAL_GAP / 2 - NODE_WIDTH / 2;
const ROOT_Y = 240;
const TITLE_FONT_SIZE = 20;
const DESC_FONT_SIZE = 13;
const BADGE_FONT_SIZE = 11;
const MAX_TITLE_LINE_CHARS = 24;
const MAX_DESC_LINE_CHARS = 34;
const NODE_TEXT_PADDING = 16;
const TITLE_LINE_HEIGHT_ESTIMATE = 29;
const DESC_LINE_HEIGHT_ESTIMATE = 19;
const INTER_SECTION_GAP = 10;
const BADGE_RIGHT_OFFSET = 38;
const TITLE_COLOR_CONCEPT = "#e67700";
const TITLE_COLOR_KNOWLEDGE = "#1864ab";
const DESC_COLOR = "#868e96";
const BADGE_COLOR_CONCEPT = "#f08c00";
const BADGE_COLOR_KNOWLEDGE = "#4dabf7";
const LEGACY_COLUMN_DIVIDER_ID = "ck-column-divider";
const CONCEPT_COLUMN_BG_ID = "ck-concept-column-bg";
const KNOWLEDGE_COLUMN_BG_ID = "ck-knowledge-column-bg";
const COLUMN_BG_EXTENT_X = 20000;
const COLUMN_BG_Y = -10000;
const COLUMN_BG_HEIGHT = 20000;
const NOVEL_MARKER_SIZE = 120;
const NOVEL_MARKER_OFFSET_X = 70;
const NOVEL_MARKER_OFFSET_Y = 90;
const VALIDATION_MARKER_SIZE = 56;
const VALIDATION_MARKER_OFFSET_X = 32;
const VALIDATION_MARKER_OFFSET_Y = 18;
const VSTATUS_FONT_SIZE = 14;
const VSTATUS_ICONS: Record<ValidationStatus, string> = {
  approved: "✓",
  undecided: "?",
  rejected: "✗",
};
const VSTATUS_COLORS: Record<ValidationStatus, string> = {
  approved: "#2f9e44",
  undecided: "#f08c00",
  rejected: "#c92a2a",
};

const CTX_BUTTON_ID_PREFIX = "ck-ctx-btn";
const CTX_BUTTON_WIDTH = 138;
const CTX_BUTTON_HEIGHT = 28;
const CTX_BUTTON_GAP = 6;
const CTX_BUTTON_OFFSET_Y = 12;

const CONCEPT_CTX_OPERATIONS: readonly CKOperation[] = [
  "ExpandConcept",
  "CreateKnowledge",
  "ValidateConcept",
  "DecideNovelConcept",
];
const KNOWLEDGE_CTX_OPERATIONS: readonly CKOperation[] = [
  "ExpandKnowledge",
  "CreateConcept",
];

const CTX_BUTTON_LABELS: Record<CKOperation, string> = {
  ExpandConcept: "Refine concept",
  CreateKnowledge: "Derive knowledge",
  ValidateConcept: "Validate",
  DecideNovelConcept: "Pick novel",
  ExpandKnowledge: "Expand knowledge",
  CreateConcept: "Derive concept",
  ReorderConcept: "Restructure concepts",
  ReorderKnowledge: "Restructure knowledge",
};

type NodeStatus = "pending" | "accepted";
type ValidationStatus = "undecided" | "approved" | "rejected";

type CKCanvasNode = CKEntryContext & {
  x: number;
  y: number;
  width: number;
  height: number;
  generated: boolean;
  status: NodeStatus;
  elementId: string;
  arrowId: string | null;
  extraArrowIds: string[];
  sourceParentIds: string[];
  sequence: number;
  createdAt: string;
  validationStatus?: ValidationStatus;
};

interface CKBoardState {
  nodes: CKCanvasNode[];
  confirmedInitialConcept: { title: string; requirements: string } | null;
  novelConceptId: string | null;
  novelMarkerElementId: string | null;
  validationMarkerElementIds: Record<string, string>;
  validationStates: Record<string, boolean>;
  showLineOfThoughtArrows: boolean;
  showNodeDescriptions: boolean;
  savedAt: string;
}

type MergedSemanticEntry = {
  id: string;
  type: CKNodeType;
  title: string;
  desc: string;
  operation_rationale?: string;
  operationRationale?: string;
  parent_id?: string | null;
  parentId?: string | null;
  source_parent_ids?: string[];
  sourceParentIds?: string[];
  validation_status?: ValidationStatus;
  validationStatus?: ValidationStatus;
};

type MergedSemanticState = {
  entries: MergedSemanticEntry[];
  confirmedInitialConcept?: { title: string; requirements: string } | null;
  showLineOfThoughtArrows?: boolean;
  showNodeDescriptions?: boolean;
  savedAt?: string;
};

const ACTION_GROUPS: readonly {
  label: string;
  operations: readonly CKOperation[];
}[] = [
  {
    label: "Explore",
    operations: [
      "ExpandConcept",
      "CreateKnowledge",
      "ExpandKnowledge",
      "CreateConcept",
    ],
  },
  {
    label: "Restructure",
    operations: ["ReorderConcept", "ReorderKnowledge"],
  },
  {
    label: "Evaluate",
    operations: ["ValidateConcept", "DecideNovelConcept"],
  },
];

const OPERATION_THEME: Record<CKOperation, string> = {
  CreateKnowledge: "c-to-k",
  ExpandKnowledge: "k-to-k",
  CreateConcept: "k-to-c",
  ExpandConcept: "c-to-c",
  ReorderConcept: "restructure-concept",
  ReorderKnowledge: "restructure-knowledge",
  ValidateConcept: "evaluate",
  DecideNovelConcept: "evaluate",
};

const OPERATION_LABELS: Record<CKOperation, string> = {
  CreateConcept: "Derive a new concept from knowledge",
  ExpandConcept: "Refine concept",
  CreateKnowledge: "Reason over concept",
  ExpandKnowledge: "Reason over knowledge",
  ReorderConcept: "Restructure the concept space",
  DecideNovelConcept: "Choose the most novel concept",
  ReorderKnowledge: "Restructure the knowledge space",
  ValidateConcept: "Check whether this concept is valid",
};

const OPERATION_DESCRIPTIONS: Record<CKOperation, string> = {
  ExpandConcept: "Push the selected concept into new directions worth exploring.",
  CreateKnowledge: "Derive concrete knowledge from the selected concept.",
  ExpandKnowledge: "Deepen the selected knowledge or derive new insights.",
  CreateConcept: "Use the selected knowledge to create a new concept.",
  ReorderConcept: "Merge, split, or relink concepts into a clearer structure.",
  ReorderKnowledge: "Merge, nest, or redefine knowledge into a cleaner map.",
  ValidateConcept: "Check whether the selected concept is supported by knowledge.",
  DecideNovelConcept: "Score all concepts and surface the most novel one.",
};

const formatNodeTypeLabel = (type: CKNodeType) =>
  type === "concept" ? "Concept" : "Knowledge";

const VALIDATION_COLORS: Record<ValidationStatus, { strokeColor: string; backgroundColor: string }> = {
  undecided: { strokeColor: "#f08c00", backgroundColor: "#fff4e6" },
  approved:    { strokeColor: "#2f9e44", backgroundColor: "#ebfbee" },
  rejected:    { strokeColor: "#c92a2a", backgroundColor: "#fff5f5" },
};

const getNodeColors = (
  type: CKNodeType,
  _status: NodeStatus,
  _nodeId?: string,
  _generated?: boolean,
  validationStatus?: ValidationStatus,
) => {
  if (type === "concept") {
    return VALIDATION_COLORS[validationStatus ?? "undecided"];
  }
  return { strokeColor: "#1864ab", backgroundColor: "#e7f5ff" };
};

const getColumnX = (type: CKNodeType) =>
  type === "concept" ? CONCEPT_COLUMN_X : KNOWLEDGE_COLUMN_X;

const getNextColumnY = (type: CKNodeType, sourceNodes: CKCanvasNode[]) => {
  const sameTypeNodes = sourceNodes
    .filter((node) => node.type === type)
    .sort((a, b) => a.y - b.y);
  if (!sameTypeNodes.length) {
    return ROOT_Y;
  }
  const lastNode = sameTypeNodes[sameTypeNodes.length - 1];
  return lastNode.y + lastNode.height + VERTICAL_GAP - NODE_HEIGHT;
};

const wrapText = (text: string, maxChars: number) => {
  const paragraphs = text.split("\n");
  const wrapped: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      wrapped.push("");
      continue;
    }

    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const next = words[i];
      if (`${current} ${next}`.length <= maxChars) {
        current = `${current} ${next}`;
      } else {
        wrapped.push(current);
        current = next;
      }
    }
    wrapped.push(current);
  }

  return wrapped.join("\n");
};

const sanitizeLabelContent = (text: string) =>
  text
    .replace(/\*\*/g, "")
    .replace(/\r/g, "")
    .replace(/^\s*concept\s*title\s*:\s*/gim, "")
    .replace(/^\s*concept\s*description\s*:\s*/gim, "")
    .replace(/^\s*description\s*:\s*/gim, "")
    .trim();

const normalizeParagraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");

const getLabelFields = (title: string, desc: string) => {
  const cleanTitle = sanitizeLabelContent(title).replace(/\s+/g, " ");
  let cleanDesc = normalizeParagraphs(sanitizeLabelContent(desc));
  const normalizedTitle = cleanTitle.toLowerCase();
  if (
    normalizedTitle &&
    cleanDesc.replace(/\s+/g, " ").toLowerCase().startsWith(normalizedTitle)
  ) {
    cleanDesc = cleanDesc.slice(cleanTitle.length).trim();
  }
  return { cleanTitle, cleanDesc };
};

const buildTitleText = (title: string) => {
  const { cleanTitle } = getLabelFields(title, "");
  return wrapText(cleanTitle, MAX_TITLE_LINE_CHARS);
};

const buildDescText = (title: string, desc: string) => {
  const { cleanDesc } = getLabelFields(title, desc);
  return wrapText(cleanDesc, MAX_DESC_LINE_CHARS);
};

const estimateNodeHeight = (
  _type: CKNodeType,
  _id: string,
  title: string,
  desc: string,
) => {
  const titleLines = buildTitleText(title).split("\n").length;
  const descLines = buildDescText(title, desc).split("\n").length;
  const estimatedHeight =
    NODE_TEXT_PADDING +
    titleLines * TITLE_LINE_HEIGHT_ESTIMATE +
    INTER_SECTION_GAP +
    descLines * DESC_LINE_HEIGHT_ESTIMATE +
    NODE_TEXT_PADDING;
  return Math.max(NODE_HEIGHT, estimatedHeight);
};

const toContextEntries = (nodes: CKCanvasNode[]): CKEntryContext[] =>
  nodes.map((node) => ({
    id: node.id,
    type: node.type,
    title: node.title,
    desc: node.desc,
    operationRationale: node.operationRationale,
    parentId: node.parentId,
    sourceParentIds: node.sourceParentIds,
    ...(node.type === "concept" && node.id !== "C0" && node.validationStatus
      ? { validationStatus: node.validationStatus }
      : {}),
  }));

const layoutColumnNodes = (columnNodes: CKCanvasNode[]) =>
  columnNodes.map((node, index, allNodes) => ({
    ...node,
    y:
      ROOT_Y -
      ((allNodes.length - 1) * VERTICAL_GAP) / 2 +
      index * VERTICAL_GAP,
  }));

const layoutConceptNodes = (conceptNodes: CKCanvasNode[]) => {
  if (!conceptNodes.length) {
    return conceptNodes;
  }

  const conceptById = new Map(conceptNodes.map((node) => [node.id, node]));
  const childrenByParentId = new Map<string, CKCanvasNode[]>();
  const roots: CKCanvasNode[] = [];

  const getConceptParentId = (node: CKCanvasNode) => {
    const candidateIds = node.sourceParentIds.length
      ? node.sourceParentIds
      : node.parentId
      ? [node.parentId]
      : [];

    const conceptParentId = candidateIds.find(
      (candidateId) => candidateId !== node.id && conceptById.has(candidateId),
    );
    return conceptParentId || null;
  };

  for (const node of conceptNodes) {
    const parentId = getConceptParentId(node);
    if (!parentId) {
      roots.push(node);
      continue;
    }

    const siblings = childrenByParentId.get(parentId) || [];
    siblings.push(node);
    childrenByParentId.set(parentId, siblings);
  }

  for (const siblings of childrenByParentId.values()) {
    siblings.sort((left, right) => left.sequence - right.sequence);
  }

  roots.sort((left, right) => left.sequence - right.sequence);

  const levels: CKCanvasNode[][] = [];
  const visited = new Set<string>();
  const queue: Array<{ node: CKCanvasNode; level: number }> = roots.map((node) => ({
    node,
    level: 0,
  }));

  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current.node.id)) {
      continue;
    }

    visited.add(current.node.id);
    if (!levels[current.level]) {
      levels[current.level] = [];
    }
    levels[current.level].push(current.node);

    const children = childrenByParentId.get(current.node.id) || [];
    for (const child of children) {
      if (!visited.has(child.id)) {
        queue.push({ node: child, level: current.level + 1 });
      }
    }
  }

  // Keep disconnected/cyclic nodes visible by placing them as extra roots.
  for (const node of conceptNodes) {
    if (visited.has(node.id)) {
      continue;
    }
    if (!levels[0]) {
      levels[0] = [];
    }
    levels[0].push(node);
  }

  const positionedById = new Map<string, CKCanvasNode>();
  for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
    const levelNodes = levels[levelIndex] || [];
    if (!levelNodes.length) {
      continue;
    }

    levelNodes.sort((left, right) => left.sequence - right.sequence);
    const startX =
      CONCEPT_COLUMN_X -
      ((levelNodes.length - 1) * CONCEPT_TREE_SIBLING_GAP) / 2;
    for (let columnIndex = 0; columnIndex < levelNodes.length; columnIndex++) {
      const node = levelNodes[columnIndex];
      positionedById.set(node.id, {
        ...node,
        x: startX + columnIndex * CONCEPT_TREE_SIBLING_GAP,
        y: ROOT_Y + levelIndex * CONCEPT_TREE_LEVEL_GAP,
      });
    }
  }

  return conceptNodes.map((node) => positionedById.get(node.id) || node);
};

const layoutKnowledgeNodes = (knowledgeNodes: CKCanvasNode[]) =>
  layoutColumnNodes(knowledgeNodes);

const dedupeIds = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

const getShortestArrowEndpoints = (
  sourceBounds: { x: number; y: number; width: number; height: number },
  targetBounds: { x: number; y: number; width: number; height: number },
) => {
  const sourceAnchors = [
    { x: sourceBounds.x + sourceBounds.width / 2, y: sourceBounds.y },
    {
      x: sourceBounds.x + sourceBounds.width,
      y: sourceBounds.y + sourceBounds.height / 2,
    },
    {
      x: sourceBounds.x + sourceBounds.width / 2,
      y: sourceBounds.y + sourceBounds.height,
    },
    { x: sourceBounds.x, y: sourceBounds.y + sourceBounds.height / 2 },
  ];

  const targetAnchors = [
    { x: targetBounds.x + targetBounds.width / 2, y: targetBounds.y },
    {
      x: targetBounds.x + targetBounds.width,
      y: targetBounds.y + targetBounds.height / 2,
    },
    {
      x: targetBounds.x + targetBounds.width / 2,
      y: targetBounds.y + targetBounds.height,
    },
    { x: targetBounds.x, y: targetBounds.y + targetBounds.height / 2 },
  ];

  let bestStart = sourceAnchors[0];
  let bestEnd = targetAnchors[0];
  let shortestDistanceSquared = Number.POSITIVE_INFINITY;

  for (const start of sourceAnchors) {
    for (const end of targetAnchors) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < shortestDistanceSquared) {
        shortestDistanceSquared = distanceSquared;
        bestStart = start;
        bestEnd = end;
      }
    }
  }

  return { start: bestStart, end: bestEnd };
};

const isLineOfThoughtConnection = (
  parentType: CKNodeType,
  childType: CKNodeType,
) => parentType !== childType;

const getConnectionStyle = (isLineOfThought: boolean) =>
  isLineOfThought
    ? {
        strokeColor: "#adb5bd",
        strokeWidth: 1,
      }
    : {
        strokeColor: "#212529",
        strokeWidth: 3,
      };

const parseNodeIndex = (nodeId: string, prefix: "C" | "K") => {
  const match = nodeId.match(new RegExp(`^${prefix}(\\d+)$`, "i"));
  return match ? Number.parseInt(match[1], 10) : null;
};

const parseExpandCount = (rawInput: string) => {
  const normalized = rawInput.trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  const value = Number.parseInt(normalized, 10);
  if (value < 1 || value > 5) {
    return null;
  }
  return value;
};

const getRequiredFocusType = (operation: CKOperation): CKNodeType | null => {
  switch (operation) {
    case "CreateConcept":
    case "ExpandKnowledge":
      return "knowledge";
    case "CreateKnowledge":
    case "ExpandConcept":
    case "ValidateConcept":
      return "concept";
    default:
      return null;
  }
};

const hasContainerId = (
  element: ExcalidrawElement,
): element is ExcalidrawElement & { containerId: string } =>
  "containerId" in element && typeof element.containerId === "string";

const NODE_ELEMENT_ID_PATTERN = /^ck-node-\d+$/;

const hasText = (
  element: ExcalidrawElement | undefined,
): element is ExcalidrawElement & { text: string } =>
  !!element && "text" in element && typeof element.text === "string";

const hasArrowBinding = (
  binding: unknown,
): binding is { id: string } =>
  !!binding && typeof binding === "object" && "id" in binding;

export const CKAgentPanel = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}) => {
  const [initialConceptTitle, setInitialConceptTitle] = useState("");
  const [initialConceptRequirements, setInitialConceptRequirements] =
    useState("");
  const [confirmedInitialConcept, setConfirmedInitialConcept] = useState<{
    title: string;
    requirements: string;
  } | null>(null);
  const [newKnowledgeTitle, setNewKnowledgeTitle] = useState("");
  const [newKnowledgeDesc, setNewKnowledgeDesc] = useState("");
  const [newConceptTitle, setNewConceptTitle] = useState("");
  const [newConceptDesc, setNewConceptDesc] = useState("");
  const [nodes, setNodes] = useState<CKCanvasNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [latestDecision, setLatestDecision] = useState("");
  const [latestRationale, setLatestRationale] = useState("");
  const [busyOperation, setBusyOperation] = useState<CKOperation | null>(null);
  const [pendingConceptLayout, setPendingConceptLayout] =
    useState<CKConceptReorderPatch | null>(null);
  const [pendingKnowledgeLayout, setPendingKnowledgeLayout] =
    useState<CKKnowledgeReorderPatch | null>(null);
  const [placingKnowledge, setPlacingKnowledge] = useState(false);
  const [placingConcept, setPlacingConcept] = useState(false);
  const [showLineOfThoughtArrows, setShowLineOfThoughtArrows] =
    useState(true);
  const [showNodeDescriptions, setShowNodeDescriptions] = useState(true);
  const [isPushing, setIsPushing] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const conceptCounterRef = useRef(0);
  const knowledgeCounterRef = useRef(-1);
  const elementCounterRef = useRef(1);
  const sequenceRef = useRef(1);
  const childCounterRef = useRef<Record<string, number>>({});
  const hasHydratedFromCanvasRef = useRef(false);
  const nodesRef = useRef<CKCanvasNode[]>([]);
  const pendingConceptLayoutBaseNodesRef = useRef<CKCanvasNode[] | null>(null);
  const pendingKnowledgeLayoutBaseNodesRef = useRef<CKCanvasNode[] | null>(
    null,
  );
  const lastInitialSeedRef = useRef<{
    title: string;
    requirements: string;
  } | null>(null);
  const novelConceptIdRef = useRef<string | null>(null);
  const novelMarkerElementIdRef = useRef<string | null>(null);
  const validationMarkerElementIdsRef = useRef<Record<string, string>>({});
  const validationStatesRef = useRef<Record<string, boolean>>({});
  const contextButtonParentIdRef = useRef<string | null>(null);

  // ─── Board persistence ──────────────────────────────────────────────────
  const _session = getStoredSession();
  const sessionId = _session?.id ?? null;
  const hasLoadedFromDbRef = useRef(false);
  // Ref-mirrors of state for use in async callbacks (avoids stale closures)
  const confirmedInitialConceptRef = useRef(confirmedInitialConcept);
  const showLineOfThoughtArrowsRef = useRef(showLineOfThoughtArrows);
  const showNodeDescriptionsRef = useRef(showNodeDescriptions);
  const isUpdatingContextButtonsRef = useRef(false);
  const lastContextButtonPosRef = useRef<{
    nodeId: string;
    x: number;
    y: number;
    height: number;
  } | null>(null);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  );
  const conceptCount = useMemo(
    () => nodes.filter((node) => node.type === "concept").length,
    [nodes],
  );
  const knowledgeCount = useMemo(
    () => nodes.filter((node) => node.type === "knowledge").length,
    [nodes],
  );
  const generatedCount = useMemo(
    () => nodes.filter((node) => node.generated).length,
    [nodes],
  );
  const canRunOperations = confirmedInitialConcept !== null;
  const topicForAgents = useMemo(() => {
    if (!confirmedInitialConcept) {
      return "";
    }

    const title = confirmedInitialConcept.title.trim();
    const requirements = confirmedInitialConcept.requirements.trim();
    if (!requirements) {
      return title;
    }

    return `${title}\nRequirements: ${requirements}`;
  }, [confirmedInitialConcept]);
  const hasPendingConceptLayout = pendingConceptLayout !== null;
  const hasPendingKnowledgeLayout = pendingKnowledgeLayout !== null;
  const hasPendingLayout = hasPendingConceptLayout || hasPendingKnowledgeLayout;

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => { confirmedInitialConceptRef.current = confirmedInitialConcept; }, [confirmedInitialConcept]);
  useEffect(() => { showLineOfThoughtArrowsRef.current = showLineOfThoughtArrows; }, [showLineOfThoughtArrows]);
  useEffect(() => { showNodeDescriptionsRef.current = showNodeDescriptions; }, [showNodeDescriptions]);

  const clearPendingLayouts = () => {
    pendingConceptLayoutBaseNodesRef.current = null;
    setPendingConceptLayout(null);
    pendingKnowledgeLayoutBaseNodesRef.current = null;
    setPendingKnowledgeLayout(null);
  };

  // ─── Serialization ────────────────────────────────────────────────────────
  const serializeCKState = (): CKBoardState => ({
    nodes: nodesRef.current,
    confirmedInitialConcept: confirmedInitialConceptRef.current,
    novelConceptId: novelConceptIdRef.current,
    novelMarkerElementId: novelMarkerElementIdRef.current,
    validationMarkerElementIds: { ...validationMarkerElementIdsRef.current },
    validationStates: { ...validationStatesRef.current },
    showLineOfThoughtArrows: showLineOfThoughtArrowsRef.current,
    showNodeDescriptions: showNodeDescriptionsRef.current,
    savedAt: new Date().toISOString(),
  });

  const restoreCKState = (state: CKBoardState) => {
    if (state.confirmedInitialConcept) {
      setInitialConceptTitle(state.confirmedInitialConcept.title);
      setInitialConceptRequirements(state.confirmedInitialConcept.requirements);
      setConfirmedInitialConcept(state.confirmedInitialConcept);
      lastInitialSeedRef.current = state.confirmedInitialConcept;
    }
    if (state.nodes?.length) {
      const migratedNodes = state.nodes.map((n) => ({
        ...n,
        createdAt: n.createdAt || new Date().toISOString(),
      }));
      setNodes(migratedNodes);
      nodesRef.current = migratedNodes;
      syncNodeDerivedRefs(migratedNodes);
    }
    novelConceptIdRef.current = state.novelConceptId ?? null;
    novelMarkerElementIdRef.current = state.novelMarkerElementId ?? null;
    validationMarkerElementIdsRef.current = state.validationMarkerElementIds ?? {};
    validationStatesRef.current = state.validationStates ?? {};
    if (state.showLineOfThoughtArrows !== undefined) {
      setShowLineOfThoughtArrows(state.showLineOfThoughtArrows);
    }
    if (state.showNodeDescriptions !== undefined) {
      setShowNodeDescriptions(state.showNodeDescriptions);
    }
  };

  const buildCKStateFromMergedSemantic = (state: MergedSemanticState): CKBoardState => {
    const now = state.savedAt || new Date().toISOString();
    const conceptEntries = state.entries
      .filter((entry) => entry.type === "concept")
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    const knowledgeEntries = state.entries
      .filter((entry) => entry.type === "knowledge")
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    let localSequence = 1;
    const makeCanvasNode = (entry: MergedSemanticEntry): CKCanvasNode => {
      const parentId = entry.parentId ?? entry.parent_id ?? null;
      const sourceParentIds = entry.sourceParentIds ?? entry.source_parent_ids ?? [];
      return {
        id: entry.id,
        type: entry.type,
        title: entry.title,
        desc: entry.desc,
        operationRationale:
          entry.operationRationale ?? entry.operation_rationale ?? "",
        parentId,
        sourceParentIds,
        validationStatus:
          entry.validationStatus ?? entry.validation_status ?? "undecided",
        x: getColumnX(entry.type),
        y: ROOT_Y,
        width: NODE_WIDTH,
        height: estimateNodeHeight(entry.type, entry.id, entry.title, entry.desc),
        generated: false,
        status: "accepted",
        elementId: `ck-merged-node-${entry.id}`,
        arrowId: null,
        extraArrowIds: [],
        sequence: localSequence++,
        createdAt: now,
      };
    };

    const conceptNodes = layoutConceptNodes(conceptEntries.map(makeCanvasNode));
    const knowledgeNodes = layoutColumnNodes(knowledgeEntries.map(makeCanvasNode));

    return {
      nodes: [...conceptNodes, ...knowledgeNodes],
      confirmedInitialConcept:
        state.confirmedInitialConcept ?? confirmedInitialConceptRef.current,
      novelConceptId: null,
      novelMarkerElementId: null,
      validationMarkerElementIds: {},
      validationStates: {},
      showLineOfThoughtArrows:
        state.showLineOfThoughtArrows ?? showLineOfThoughtArrowsRef.current,
      showNodeDescriptions:
        state.showNodeDescriptions ?? showNodeDescriptionsRef.current,
      savedAt: now,
    };
  };

  // ─── Apply merged state when merge completes ─────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const { mergedState } = (e as CustomEvent).detail ?? {};
      if (!mergedState || typeof mergedState !== "object") {
        return;
      }

      const previousNodes = nodesRef.current;
      const nextState =
        "nodes" in mergedState
          ? (mergedState as CKBoardState)
          : "entries" in mergedState
          ? buildCKStateFromMergedSemantic(mergedState as MergedSemanticState)
          : null;

      if (!nextState) {
        return;
      }

      clearPendingLayouts();
      restoreCKState(nextState);
      if (excalidrawAPI) {
        redrawAllNodesOnCanvas(nextState.nodes, {
          previousNodesOverride: previousNodes,
        });
      }
    };
    window.addEventListener("ck-merge-apply", handler);
    return () => window.removeEventListener("ck-merge-apply", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excalidrawAPI]);

  // ─── Disable localStorage while session is active ────────────────────────
  useEffect(() => {
    LocalData.pauseSave("collaboration");
    return () => LocalData.resumeSave("collaboration");
  }, []);

  // ─── Load from DB on mount ────────────────────────────────────────────────
  useEffect(() => {
    if (!excalidrawAPI || !sessionId || hasLoadedFromDbRef.current) return;
    hasLoadedFromDbRef.current = true;

    loadBoard(sessionId)
      .then((board) => {
        const currentSession = getStoredSession();
        const raw = board?.ck_nodes as unknown;
        const hasSemanticState =
          !!raw &&
          typeof raw === "object" &&
          !Array.isArray(raw) &&
          "nodes" in raw &&
          Array.isArray((raw as { nodes?: unknown[] }).nodes) &&
          ((raw as { nodes: unknown[] }).nodes?.length ?? 0) > 0;

        console.log("[CKBoard] loadBoard result:", {
          sessionId,
          boardFound: !!board,
          elementCount: (board?.elements as unknown[] | null)?.length ?? 0,
          hasCKNodes: !!board?.ck_nodes && !Array.isArray(board.ck_nodes),
        });

        if (!board || !(board.elements as unknown[])?.length) {
          if (hasSemanticState) {
            const semanticState = raw as CKBoardState;
            restoreCKState(semanticState);
            redrawAllNodesOnCanvas(semanticState.nodes, {
              previousNodesOverride: [],
            });
            hasHydratedFromCanvasRef.current = true;
            return;
          }

          // No saved board or empty board — seed from session metadata
          if (currentSession?.initial_concept) {
            const title = currentSession.initial_concept;
            const requirements = currentSession.requirements ?? "";
            setInitialConceptTitle(title);
            setInitialConceptRequirements(requirements);
            setConfirmedInitialConcept({ title, requirements });
            lastInitialSeedRef.current = { title, requirements };
          }
          if (!board) return;
        }

        const restoredElements = restoreElements(
          board.elements as ExcalidrawElement[],
          null,
          { repairBindings: true, deleteInvisibleElements: false },
        );
        console.log("[CKBoard] restored elements:", restoredElements.length);

        const appStateFromDB = board.app_state as Record<string, unknown> | null;
        const sceneUpdate: Parameters<typeof excalidrawAPI.updateScene>[0] = {
          elements: restoredElements,
          captureUpdate: CaptureUpdateAction.NEVER,
        };
        if (appStateFromDB?.scrollX != null || appStateFromDB?.zoom != null) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sceneUpdate.appState = {
            ...(appStateFromDB.scrollX != null ? { scrollX: appStateFromDB.scrollX as number } : {}),
            ...(appStateFromDB.scrollY != null ? { scrollY: appStateFromDB.scrollY as number } : {}),
            ...(appStateFromDB.zoom != null ? { zoom: appStateFromDB.zoom as { value: number } } : {}),
          } as any;
        }
        excalidrawAPI.updateScene(sceneUpdate);

        // Reorder restored elements so column bgs are first (they may have been
        // saved in wrong order by an older version, causing them to render on top).
        {
          const BG_IDS_DB = new Set([CONCEPT_COLUMN_BG_ID, KNOWLEDGE_COLUMN_BG_ID]);
          const allRestored = Array.from(excalidrawAPI.getSceneElementsIncludingDeleted());
          const bgFirst = allRestored.filter((el) => BG_IDS_DB.has(el.id));
          const nonBg = allRestored.filter((el) => !BG_IDS_DB.has(el.id));
          if (bgFirst.length > 0) {
            excalidrawAPI.updateScene({
              elements: [...bgFirst, ...nonBg],
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
        }

        if (raw && typeof raw === "object" && !Array.isArray(raw) && "nodes" in raw) {
          restoreCKState(raw as CKBoardState);
          hasHydratedFromCanvasRef.current = true;
        }
      })
      .catch((err) => {
        console.error("[CKBoard] Load failed:", err);
        const currentSession = getStoredSession();
        if (currentSession?.initial_concept) {
          const title = currentSession.initial_concept;
          const requirements = currentSession.requirements ?? "";
          setInitialConceptTitle(title);
          setInitialConceptRequirements(requirements);
          setConfirmedInitialConcept({ title, requirements });
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excalidrawAPI, sessionId]);

  const clearContextButtons = () => {
    contextButtonParentIdRef.current = null;
    lastContextButtonPosRef.current = null;
    if (!excalidrawAPI) {
      return;
    }

    const currentElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const hasAny = currentElements.some(
      (el) => !el.isDeleted && el.id.startsWith(CTX_BUTTON_ID_PREFIX),
    );
    if (!hasAny) {
      return;
    }

    excalidrawAPI.updateScene({
      elements: currentElements.map((el) =>
        el.id.startsWith(CTX_BUTTON_ID_PREFIX)
          ? newElementWith(el, { isDeleted: true })
          : el,
      ),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  };

  const renderContextButtons = (
    node: CKCanvasNode,
    liveX?: number,
    liveY?: number,
    liveWidth?: number,
    liveHeight?: number,
  ) => {
    if (!excalidrawAPI || isUpdatingContextButtonsRef.current) {
      return;
    }

    isUpdatingContextButtonsRef.current = true;

    const operations =
      node.type === "concept" ? CONCEPT_CTX_OPERATIONS : KNOWLEDGE_CTX_OPERATIONS;

    const nodeX = liveX ?? node.x;
    const nodeY = liveY ?? node.y;
    const nodeW = liveWidth ?? node.width;
    const nodeH = liveHeight ?? node.height;

    const totalWidth =
      operations.length * CTX_BUTTON_WIDTH + (operations.length - 1) * CTX_BUTTON_GAP;
    const startX = nodeX + nodeW / 2 - totalWidth / 2;
    const startY = nodeY + nodeH + CTX_BUTTON_OFFSET_Y;
    const skeleton: ExcalidrawElementSkeleton[] = [];
    operations.forEach((op, i) => {
      const btnX = startX + i * (CTX_BUTTON_WIDTH + CTX_BUTTON_GAP);
      const btnId = `${CTX_BUTTON_ID_PREFIX}-${op}`;
      const labelId = `${btnId}-label`;
      skeleton.push({
        id: btnId,
        type: "rectangle",
        x: btnX,
        y: startY,
        width: CTX_BUTTON_WIDTH,
        height: CTX_BUTTON_HEIGHT,
        backgroundColor: "#f8f9fa",
        strokeColor: "#adb5bd",
        strokeWidth: 1,
        opacity: 60,
        roundness: { type: 3 },
      });
      skeleton.push({
        id: labelId,
        type: "text",
        x: btnX + 8,
        y: startY + 6,
        text: CTX_BUTTON_LABELS[op],
        fontSize: 13,
        fontFamily: FONT_FAMILY["Liberation Sans"],
        strokeColor: "#495057",
        opacity: 75,
      } as ExcalidrawElementSkeleton);
    });

    const generated = convertToExcalidrawElements(skeleton, { regenerateIds: false });
    const currentElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    // Remove old buttons then add new ones
    const withoutOld = currentElements.map((el) =>
      el.id.startsWith(CTX_BUTTON_ID_PREFIX)
        ? newElementWith(el, { isDeleted: true })
        : el,
    );
    excalidrawAPI.updateScene({
      elements: [...withoutOld, ...generated],
      captureUpdate: CaptureUpdateAction.NEVER,
    });

    contextButtonParentIdRef.current = node.id;
    lastContextButtonPosRef.current = { nodeId: node.id, x: nodeX, y: nodeY, height: nodeH };
    isUpdatingContextButtonsRef.current = false;
  };

  const handleCanvasSelectionChange = (
    selectedElementIds: Readonly<Record<string, true>> | undefined,
  ) => {
    const selectedIds = new Set(Object.keys(selectedElementIds || {}));

    // Check if any context button or its label was clicked.
    const validContextOps = [
      ...CONCEPT_CTX_OPERATIONS,
      ...KNOWLEDGE_CTX_OPERATIONS,
    ] as CKOperation[];
    const clickedContextOp = [...selectedIds].reduce<CKOperation | null>(
      (foundOp, selectedId) => {
        if (foundOp) {
          return foundOp;
        }
        if (!selectedId.startsWith(CTX_BUTTON_ID_PREFIX)) {
          return null;
        }

        const baseButtonId = selectedId.endsWith("-label")
          ? selectedId.slice(0, -"-label".length)
          : selectedId;
        const opId = baseButtonId.replace(`${CTX_BUTTON_ID_PREFIX}-`, "");
        return validContextOps.includes(opId as CKOperation)
          ? (opId as CKOperation)
          : null;
      },
      null,
    );

    if (clickedContextOp) {
      const parentId = contextButtonParentIdRef.current ?? selectedNodeId;
      // Clear before async operation so position re-render doesn't conflict
      contextButtonParentIdRef.current = null;
      lastContextButtonPosRef.current = null;
      if (parentId) {
        selectNodeOnCanvas(parentId);
        void runOperation(clickedContextOp, parentId);
      }
      return;
    }

    syncSelectedNodeFromCanvas(selectedElementIds);
  };

  const hydrateStateFromCanvas = () => {
    if (!excalidrawAPI) {
      return false;
    }

    const liveElements = excalidrawAPI
      .getSceneElementsIncludingDeleted()
      .filter((element) => !element.isDeleted);
    const elementById = new Map(liveElements.map((element) => [element.id, element]));
    const nodeRectangles = liveElements.filter(
      (element) =>
        element.type === "rectangle" && NODE_ELEMENT_ID_PATTERN.test(element.id),
    );

    if (!nodeRectangles.length) {
      return false;
    }

    const nodeIdByElementId = new Map<string, string>();
    const nodeTypeById = new Map<string, CKNodeType>();

    for (const rectangle of nodeRectangles) {
      const badgeElement = elementById.get(`${rectangle.id}-badge`);
      const badgeText = hasText(badgeElement) ? badgeElement.text.trim() : "";
      if (!/^[CK]\d+$/i.test(badgeText)) {
        continue;
      }

      const normalizedNodeId = badgeText.toUpperCase();
      nodeIdByElementId.set(rectangle.id, normalizedNodeId);
      nodeTypeById.set(
        normalizedNodeId,
        normalizedNodeId.startsWith("C") ? "concept" : "knowledge",
      );
    }

    if (!nodeIdByElementId.size) {
      return false;
    }

    const sourceParentIdsByNodeId = new Map<string, string[]>();
    const arrowIdsByNodeId = new Map<string, string[]>();
    for (const element of liveElements) {
      if (element.type !== "arrow") {
        continue;
      }

      const startCandidate = (element as unknown as { start?: unknown }).start;
      const endCandidate = (element as unknown as { end?: unknown }).end;
      const startBinding = hasArrowBinding(startCandidate)
        ? startCandidate
        : null;
      const endBinding = hasArrowBinding(endCandidate) ? endCandidate : null;
      if (!startBinding || !endBinding) {
        continue;
      }

      const parentNodeId = nodeIdByElementId.get(startBinding.id);
      const childNodeId = nodeIdByElementId.get(endBinding.id);
      if (!parentNodeId || !childNodeId) {
        continue;
      }

      const nextParents = sourceParentIdsByNodeId.get(childNodeId) || [];
      nextParents.push(parentNodeId);
      sourceParentIdsByNodeId.set(childNodeId, nextParents);

      const nextArrowIds = arrowIdsByNodeId.get(childNodeId) || [];
      nextArrowIds.push(element.id);
      arrowIdsByNodeId.set(childNodeId, nextArrowIds);
    }

    const recoveredNodes = nodeRectangles
      .map((rectangle) => {
        const recoveredNodeId = nodeIdByElementId.get(rectangle.id);
        if (!recoveredNodeId) {
          return null;
        }

        const recoveredType = nodeTypeById.get(recoveredNodeId);
        if (!recoveredType) {
          return null;
        }

        const titleElement = elementById.get(`${rectangle.id}-title`);
        const descElement = elementById.get(`${rectangle.id}-desc`);
        const recoveredTitle = hasText(titleElement)
          ? titleElement.text.trim()
          : recoveredNodeId;
        const recoveredDesc = hasText(descElement)
          ? descElement.text.trim()
          : "Recovered from canvas.";
        const recoveredSourceParentIds = dedupeIds(
          sourceParentIdsByNodeId.get(recoveredNodeId) || [],
        );
        const recoveredArrowIds = arrowIdsByNodeId.get(recoveredNodeId) || [];

        return {
          id: recoveredNodeId,
          type: recoveredType,
          title: recoveredTitle,
          desc: recoveredDesc,
          operationRationale:
            recoveredNodeId === "C0"
              ? "User-defined starting concept."
              : "Recovered from canvas.",
          parentId: recoveredSourceParentIds[0] || null,
          sourceParentIds: recoveredSourceParentIds,
          x: rectangle.x,
          y: rectangle.y,
          width: rectangle.width,
          height: rectangle.height,
          generated: false,
          status: "accepted" as const,
          elementId: rectangle.id,
          arrowId: recoveredArrowIds[0] || null,
          extraArrowIds: recoveredArrowIds.slice(1),
          sequence: 0,
          createdAt: new Date().toISOString(),
        } as CKCanvasNode;
      })
      .filter((node): node is CKCanvasNode => !!node)
      .sort((left, right) => left.y - right.y || left.x - right.x)
      .map((node, index) => ({
        ...node,
        sequence: index + 1,
      }));

    if (!recoveredNodes.length) {
      return false;
    }

    const rootNode = recoveredNodes.find(
      (node) => node.id === "C0" && node.type === "concept",
    );
    if (rootNode) {
      const rootRequirements = rootNode.desc || "";
      setInitialConceptTitle(rootNode.title);
      setInitialConceptRequirements(rootRequirements);
      setConfirmedInitialConcept({
        title: rootNode.title,
        requirements: rootRequirements,
      });
      lastInitialSeedRef.current = {
        title: rootNode.title,
        requirements: rootRequirements,
      };
    }

    setNodes(recoveredNodes);
    nodesRef.current = recoveredNodes;
    syncNodeDerivedRefs(recoveredNodes);
    clearPendingLayouts();
    syncSelectedNodeFromCanvas(excalidrawAPI.getAppState().selectedElementIds);

    return true;
  };

  const tryHydrateFromCanvas = () => {
    if (!excalidrawAPI || hasHydratedFromCanvasRef.current) {
      return false;
    }

    const hydrated = hydrateStateFromCanvas();
    if (hydrated) {
      hasHydratedFromCanvasRef.current = true;
    }
    return hydrated;
  };

  const syncSelectedNodeFromCanvas = (
    selectedElementIds: Readonly<Record<string, true>> | undefined,
  ) => {
    const selectedIds = new Set(Object.keys(selectedElementIds || {}));
    const matchedNodes = nodesRef.current.filter((node) => {
      const nodeElementIds = [
        node.elementId,
        `${node.elementId}-title`,
        `${node.elementId}-desc`,
        `${node.elementId}-badge`,
      ];
      return nodeElementIds.some((elementId) => selectedIds.has(elementId));
    });

    if (matchedNodes.length === 1) {
      setSelectedNodeId(matchedNodes[0].id);
      return;
    }

    setSelectedNodeId(null);
  };

  const selectNodeOnCanvas = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);

    if (!excalidrawAPI) {
      return;
    }

    const nextSelectedNode = nodeId
      ? nodesRef.current.find((node) => node.id === nodeId) || null
      : null;

    excalidrawAPI.updateScene({
      appState: {
        selectedElementIds: nextSelectedNode
          ? {
              [nextSelectedNode.elementId]: true,
              [`${nextSelectedNode.elementId}-title`]: true,
              [`${nextSelectedNode.elementId}-desc`]: true,
              [`${nextSelectedNode.elementId}-badge`]: true,
            }
          : {},
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  };

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    tryHydrateFromCanvas();
    handleCanvasSelectionChange(excalidrawAPI.getAppState().selectedElementIds);

    return excalidrawAPI.onChange((elements, appState) => {
      if (!hasHydratedFromCanvasRef.current && nodesRef.current.length === 0) {
        tryHydrateFromCanvas();
      }
      handleCanvasSelectionChange(appState.selectedElementIds);

      // Re-render context buttons when the selected node is dragged
      const parentId = contextButtonParentIdRef.current;
      if (parentId && !isUpdatingContextButtonsRef.current) {
        const parentNode = nodesRef.current.find((n) => n.id === parentId);
        if (parentNode) {
          const el = elements.find(
            (e) => e.id === parentNode.elementId && !e.isDeleted,
          );
          if (el) {
            const last = lastContextButtonPosRef.current;
            if (
              !last ||
              last.nodeId !== parentId ||
              Math.abs(el.x - last.x) > 0.5 ||
              Math.abs(el.y - last.y) > 0.5 ||
              Math.abs(el.height - last.height) > 0.5
            ) {
              renderContextButtons(parentNode, el.x, el.y, el.width, el.height);
            }
          }
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excalidrawAPI]);

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    handleCanvasSelectionChange(excalidrawAPI.getAppState().selectedElementIds);
  }, [excalidrawAPI, nodes]);

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    const selectedNode = selectedNodeId
      ? nodesRef.current.find((node) => node.id === selectedNodeId) || null
      : null;
    if (!selectedNode) {
      clearContextButtons();
      return;
    }

    renderContextButtons(selectedNode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, nodes, excalidrawAPI]);

  useEffect(() => {
    const hideEditPanel = !!selectedNodeId;
    document.documentElement.classList.toggle(
      "ck-hide-node-edit-panel",
      hideEditPanel,
    );

    if (hideEditPanel && excalidrawAPI) {
      excalidrawAPI.updateScene({
        appState: { openSidebar: null },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }

    return () => {
      document.documentElement.classList.remove("ck-hide-node-edit-panel");
    };
  }, [selectedNodeId, excalidrawAPI]);

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    tryHydrateFromCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excalidrawAPI]);

  const nextElementId = (prefix: string) =>
    `ck-${prefix}-${elementCounterRef.current++}`;

  const nextNodeId = (type: CKNodeType) => {
    if (type === "concept") {
      conceptCounterRef.current += 1;
      return `C${conceptCounterRef.current}`;
    }

    knowledgeCounterRef.current += 1;
    return `K${knowledgeCounterRef.current}`;
  };

  const pruneDeletedGeneratedNodes = (sourceNodes: CKCanvasNode[]) => {
    if (!excalidrawAPI || !sourceNodes.length) {
      return sourceNodes;
    }

    const aliveElementIds = new Set(
      excalidrawAPI
        .getSceneElementsIncludingDeleted()
        .filter((element) => !element.isDeleted)
        .map((element) => element.id),
    );

    const pruned = sourceNodes.filter(
      (node) => !node.generated || aliveElementIds.has(node.elementId),
    );
    const prunedNodeIds = new Set(pruned.map((node) => node.id));
    const removedNodes = sourceNodes.filter((node) => !prunedNodeIds.has(node.id));
    const removedNodeIdSet = new Set(removedNodes.map((node) => node.id));
    const removedElementIdSet = new Set(removedNodes.map((node) => node.elementId));

    const sanitizedNodes = pruned.map((node) => {
      const sourceParentIds = node.sourceParentIds.length
        ? node.sourceParentIds
        : node.parentId
        ? [node.parentId]
        : [];
      const arrowIds = [
        ...(node.arrowId ? [node.arrowId] : []),
        ...node.extraArrowIds,
      ];

      const keptPairs = sourceParentIds.reduce<
        Array<{ parentId: string; arrowId: string | null }>
      >((accumulator, parentId, index) => {
        if (removedNodeIdSet.has(parentId)) {
          return accumulator;
        }
        accumulator.push({
          parentId,
          arrowId: arrowIds[index] || null,
        });
        return accumulator;
      }, []);

      const nextSourceParentIds = dedupeIds(
        keptPairs.map((pair) => pair.parentId),
      );
      const nextArrowIds = keptPairs
        .map((pair) => pair.arrowId)
        .filter((arrowId): arrowId is string => !!arrowId);

      return {
        ...node,
        parentId: nextSourceParentIds[0] || null,
        sourceParentIds: nextSourceParentIds,
        arrowId: nextArrowIds[0] || null,
        extraArrowIds: nextArrowIds.slice(1),
      };
    });

    if (removedElementIdSet.size) {
      const currentElements = excalidrawAPI.getSceneElementsIncludingDeleted();
      const updatedElements = currentElements.map((element) => {
        if (element.isDeleted || element.type !== "arrow") {
          return element;
        }

        const startCandidate = (element as unknown as { start?: unknown }).start;
        const endCandidate = (element as unknown as { end?: unknown }).end;
        const startBinding = hasArrowBinding(startCandidate)
          ? startCandidate
          : null;
        const endBinding = hasArrowBinding(endCandidate) ? endCandidate : null;

        if (
          (startBinding && removedElementIdSet.has(startBinding.id)) ||
          (endBinding && removedElementIdSet.has(endBinding.id))
        ) {
          return newElementWith(element, { isDeleted: true });
        }

        return element;
      });
      excalidrawAPI.updateScene({ elements: updatedElements });
    }
    if (
      novelConceptIdRef.current &&
      !sanitizedNodes.some((node) => node.id === novelConceptIdRef.current)
    ) {
      clearNovelMarkerFromCanvas();
    }
    for (const [conceptId, markerId] of Object.entries(
      validationMarkerElementIdsRef.current,
    )) {
      if (
        !sanitizedNodes.some(
          (node) => node.id === conceptId && node.type === "concept",
        )
      ) {
        const currentElements =
          excalidrawAPI.getSceneElementsIncludingDeleted();
        const updatedElements = currentElements.map((element) =>
          element.id === markerId
            ? newElementWith(element, { isDeleted: true })
            : element,
        );
        excalidrawAPI.updateScene({ elements: updatedElements });
        delete validationMarkerElementIdsRef.current[conceptId];
        delete validationStatesRef.current[conceptId];
      }
    }

    if (sanitizedNodes.length !== sourceNodes.length) {
      setNodes(sanitizedNodes);
      setSelectedNodeId((prevSelected) =>
        sanitizedNodes.some((node) => node.id === prevSelected)
          ? prevSelected
          : null,
      );
      nodesRef.current = sanitizedNodes;
      syncNodeDerivedRefs(sanitizedNodes);
      clearPendingLayouts();
    }

    return sanitizedNodes;
  };

  const toast = (message: string) => {
    if (excalidrawAPI) {
      excalidrawAPI.setToast({ message });
    }
  };

  function clearNovelMarkerFromCanvas() {
    const markerId = novelMarkerElementIdRef.current;
    if (!excalidrawAPI || !markerId) {
      novelConceptIdRef.current = null;
      novelMarkerElementIdRef.current = null;
      return;
    }
    const currentElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const updatedElements = currentElements.map((element) =>
      element.id === markerId
        ? newElementWith(element, { isDeleted: true })
        : element,
    );
    excalidrawAPI.updateScene({ elements: updatedElements });
    novelConceptIdRef.current = null;
    novelMarkerElementIdRef.current = null;
  }

  function clearValidationMarkerFromCanvas(conceptId?: string) {
    if (!excalidrawAPI) {
      if (conceptId) {
        delete validationMarkerElementIdsRef.current[conceptId];
        delete validationStatesRef.current[conceptId];
      } else {
        validationMarkerElementIdsRef.current = {};
        validationStatesRef.current = {};
      }
      return;
    }

    const conceptIds = conceptId
      ? [conceptId]
      : Object.keys(validationMarkerElementIdsRef.current);
    if (!conceptIds.length) {
      return;
    }

    const markerIds = conceptIds
      .map((id) => validationMarkerElementIdsRef.current[id])
      .filter(Boolean);
    if (!markerIds.length) {
      return;
    }

    const markerIdSet = new Set(markerIds);
    const currentElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const updatedElements = currentElements.map((element) =>
      markerIdSet.has(element.id)
        ? newElementWith(element, { isDeleted: true })
        : element,
    );
    excalidrawAPI.updateScene({ elements: updatedElements });

    for (const id of conceptIds) {
      delete validationMarkerElementIdsRef.current[id];
      delete validationStatesRef.current[id];
    }
  }

  function markValidationOnCanvas(conceptId: string, isValid: boolean) {
    if (!excalidrawAPI) {
      return;
    }
    const targetNode = nodesRef.current.find(
      (node) => node.id === conceptId && node.type === "concept",
    );
    if (!targetNode) {
      toast(`Could not find concept ${conceptId} on canvas.`);
      return;
    }

    const currentElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const updatedElements = [...currentElements];
    const previousMarkerId = validationMarkerElementIdsRef.current[conceptId];
    if (previousMarkerId) {
      for (let i = 0; i < updatedElements.length; i++) {
        if (updatedElements[i].id === previousMarkerId) {
          updatedElements[i] = newElementWith(updatedElements[i], {
            isDeleted: true,
          });
          break;
        }
      }
    }

    const liveNodeElement = currentElements.find(
      (element) => element.id === targetNode.elementId && !element.isDeleted,
    );
    const markerX =
      (liveNodeElement?.x ?? targetNode.x) +
      (liveNodeElement?.width ?? targetNode.width) -
      VALIDATION_MARKER_OFFSET_X;
    const markerY =
      (liveNodeElement?.y ?? targetNode.y) - VALIDATION_MARKER_OFFSET_Y;
    const markerId = nextElementId("validation");
    const marker = convertToExcalidrawElements(
      [
        {
          id: markerId,
          type: "text",
          x: markerX,
          y: markerY,
          text: isValid ? "✓" : "X",
          fontSize: VALIDATION_MARKER_SIZE,
          strokeColor: isValid ? "#2b8a3e" : "#c92a2a",
          roughness: 0,
        },
      ],
      { regenerateIds: false },
    );

    excalidrawAPI.updateScene({
      elements: [...updatedElements, ...marker],
    });
    validationMarkerElementIdsRef.current[conceptId] = markerId;
    validationStatesRef.current[conceptId] = isValid;
  }

  function markNovelConceptOnCanvas(conceptId: string) {
    if (!excalidrawAPI) {
      return;
    }
    const targetNode = nodesRef.current.find(
      (node) => node.id === conceptId && node.type === "concept",
    );
    if (!targetNode) {
      toast(`Could not find concept ${conceptId} on canvas.`);
      return;
    }

    const currentElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const updatedElements = [...currentElements];

    if (novelMarkerElementIdRef.current) {
      for (let i = 0; i < updatedElements.length; i++) {
        if (updatedElements[i].id === novelMarkerElementIdRef.current) {
          updatedElements[i] = newElementWith(updatedElements[i], {
            isDeleted: true,
          });
          break;
        }
      }
    }

    const liveNodeElement = currentElements.find(
      (element) => element.id === targetNode.elementId && !element.isDeleted,
    );
    const markerX =
      (liveNodeElement?.x ?? targetNode.x) - NOVEL_MARKER_OFFSET_X;
    const markerY =
      (liveNodeElement?.y ?? targetNode.y) - NOVEL_MARKER_OFFSET_Y;
    const markerId = nextElementId("novel-star");

    const star = convertToExcalidrawElements(
      [
        {
          id: markerId,
          type: "text",
          x: markerX,
          y: markerY,
          text: "★",
          fontSize: NOVEL_MARKER_SIZE,
          strokeColor: "#f08c00",
          roughness: 0,
        },
      ],
      { regenerateIds: false },
    );

    excalidrawAPI.updateScene({
      elements: [...updatedElements, ...star],
    });
    novelConceptIdRef.current = conceptId;
    novelMarkerElementIdRef.current = markerId;
  }

  const deleteNodesFromCanvas = (
    nodesToDelete: CKCanvasNode[],
    options?: { removeDivider?: boolean },
  ) => {
    if (!excalidrawAPI || !nodesToDelete.length) {
      return;
    }

    const ids = new Set<string>();
    if (options?.removeDivider) {
      ids.add(LEGACY_COLUMN_DIVIDER_ID);
      ids.add(CONCEPT_COLUMN_BG_ID);
      ids.add(KNOWLEDGE_COLUMN_BG_ID);
    }
    for (const node of nodesToDelete) {
      ids.add(node.elementId);
      ids.add(`${node.elementId}-title`);
      ids.add(`${node.elementId}-desc`);
      ids.add(`${node.elementId}-badge`);
      ids.add(`${node.elementId}-vstatus`);
      if (node.arrowId) {
        ids.add(node.arrowId);
      }
      for (const extraArrowId of node.extraArrowIds) {
        ids.add(extraArrowId);
      }
    }
    if (
      novelMarkerElementIdRef.current &&
      novelConceptIdRef.current &&
      nodesToDelete.some((node) => node.id === novelConceptIdRef.current)
    ) {
      ids.add(novelMarkerElementIdRef.current);
      novelConceptIdRef.current = null;
      novelMarkerElementIdRef.current = null;
    }
    for (const node of nodesToDelete) {
      if (node.type !== "concept") {
        continue;
      }
      const validationMarkerId = validationMarkerElementIdsRef.current[node.id];
      if (validationMarkerId) {
        ids.add(validationMarkerId);
        delete validationMarkerElementIdsRef.current[node.id];
      }
      delete validationStatesRef.current[node.id];
    }

    const currentElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const updatedElements = currentElements.map((element) => {
      if (ids.has(element.id)) {
        return newElementWith(element, { isDeleted: true });
      }
      if (hasContainerId(element) && ids.has(element.containerId)) {
        return newElementWith(element, { isDeleted: true });
      }
      return element;
    });

    excalidrawAPI.updateScene({ elements: updatedElements });
  };

  const addNodesToCanvas = (
    nodesToAdd: CKCanvasNode[],
    existingNodes: CKCanvasNode[],
    options?: { shouldScroll?: boolean },
  ) => {
    if (!excalidrawAPI || !nodesToAdd.length) {
      return;
    }

    const allNodes = new Map<string, CKCanvasNode>();
    for (const node of existingNodes) {
      allNodes.set(node.id, node);
    }
    for (const node of nodesToAdd) {
      allNodes.set(node.id, node);
    }

    const currentElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const liveElementById = new Map(
      currentElements
        .filter((element) => !element.isDeleted)
        .map((element) => [element.id, element]),
    );
    const getLiveBounds = (candidate: CKCanvasNode) => {
      const live = liveElementById.get(candidate.elementId);
      if (!live) {
        return candidate;
      }
      return {
        x: live.x,
        y: live.y,
        width: live.width,
        height: live.height,
      };
    };

    const skeleton: ExcalidrawElementSkeleton[] = [];

    const hasConceptColumnBg = liveElementById.has(CONCEPT_COLUMN_BG_ID);
    const hasKnowledgeColumnBg = liveElementById.has(KNOWLEDGE_COLUMN_BG_ID);
    if (!hasConceptColumnBg) {
      skeleton.push({
        id: CONCEPT_COLUMN_BG_ID,
        type: "rectangle",
        x: -COLUMN_BG_EXTENT_X,
        y: COLUMN_BG_Y,
        width: DIVIDER_X + COLUMN_BG_EXTENT_X,
        height: COLUMN_BG_HEIGHT,
        backgroundColor: "#fff9db",
        strokeColor: "transparent",
        roughness: 0,
        strokeWidth: 0,
        locked: true,
      });
    }
    if (!hasKnowledgeColumnBg) {
      skeleton.push({
        id: KNOWLEDGE_COLUMN_BG_ID,
        type: "rectangle",
        x: DIVIDER_X,
        y: COLUMN_BG_Y,
        width: COLUMN_BG_EXTENT_X,
        height: COLUMN_BG_HEIGHT,
        backgroundColor: "#ebfbee",
        strokeColor: "transparent",
        roughness: 0,
        strokeWidth: 0,
        locked: true,
      });
    }

    for (const node of nodesToAdd) {
      const colors = getNodeColors(
        node.type,
        node.status,
        node.id,
        node.generated,
        node.validationStatus,
      );
      const groupId = `${node.elementId}-g`;
      const textWidth = node.width - 2 * NODE_TEXT_PADDING;
      const titleText = buildTitleText(node.title);
      const descText = buildDescText(node.title, node.desc);
      const titleLines = titleText.split("\n").length;
      const titleBlockHeight =
        titleLines * TITLE_LINE_HEIGHT_ESTIMATE + INTER_SECTION_GAP;
      const titleColor =
        node.type === "concept" ? TITLE_COLOR_CONCEPT : TITLE_COLOR_KNOWLEDGE;
      const badgeColor =
        node.type === "concept" ? BADGE_COLOR_CONCEPT : BADGE_COLOR_KNOWLEDGE;
      skeleton.push({
        id: node.elementId,
        type: "rectangle",
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        backgroundColor: colors.backgroundColor,
        strokeColor: colors.strokeColor,
        groupIds: [groupId],
      });
      skeleton.push({
        id: `${node.elementId}-title`,
        type: "text",
        x: node.x + NODE_TEXT_PADDING,
        y: node.y + NODE_TEXT_PADDING,
        width: textWidth,
        text: titleText,
        fontSize: TITLE_FONT_SIZE,
        fontFamily: FONT_FAMILY["Liberation Sans"],
        strokeColor: titleColor,
        autoResize: false,
        groupIds: [groupId],
      } as ExcalidrawElementSkeleton);
      if (showNodeDescriptions) {
        skeleton.push({
          id: `${node.elementId}-desc`,
          type: "text",
          x: node.x + NODE_TEXT_PADDING,
          y: node.y + NODE_TEXT_PADDING + titleBlockHeight,
          width: textWidth,
          text: descText,
          fontSize: DESC_FONT_SIZE,
          fontFamily: FONT_FAMILY["Liberation Sans"],
          strokeColor: DESC_COLOR,
          autoResize: false,
          groupIds: [groupId],
        } as ExcalidrawElementSkeleton);
      }
      skeleton.push({
        id: `${node.elementId}-badge`,
        type: "text",
        x: node.x + node.width - NODE_TEXT_PADDING - BADGE_RIGHT_OFFSET,
        y: node.y + NODE_TEXT_PADDING,
        text: node.id,
        fontSize: BADGE_FONT_SIZE,
        fontFamily: FONT_FAMILY["Liberation Sans"],
        strokeColor: badgeColor,
        groupIds: [groupId],
      } as ExcalidrawElementSkeleton);

      // Validation status icon — top-right corner, concepts only, not C0
      if (node.type === "concept" && node.id !== "C0" && node.validationStatus) {
        skeleton.push({
          id: `${node.elementId}-vstatus`,
          type: "text",
          x: node.x + node.width - NODE_TEXT_PADDING - BADGE_RIGHT_OFFSET - VSTATUS_FONT_SIZE - 4,
          y: node.y + NODE_TEXT_PADDING,
          text: VSTATUS_ICONS[node.validationStatus],
          fontSize: VSTATUS_FONT_SIZE,
          fontFamily: FONT_FAMILY["Liberation Sans"],
          strokeColor: VSTATUS_COLORS[node.validationStatus],
          groupIds: [groupId],
        } as ExcalidrawElementSkeleton);
      }

      const sourceParentIds = node.sourceParentIds.length
        ? node.sourceParentIds
        : node.parentId
        ? [node.parentId]
        : [];
      const arrowIds = [
        ...(node.arrowId ? [node.arrowId] : []),
        ...node.extraArrowIds,
      ];

      for (let i = 0; i < sourceParentIds.length; i++) {
        const parentId = sourceParentIds[i];
        const arrowId = arrowIds[i];
        if (!arrowId) {
          continue;
        }

        const parent = allNodes.get(parentId);
        if (!parent) {
          continue;
        }
        const isLineOfThought = isLineOfThoughtConnection(
          parent.type,
          node.type,
        );
        if (isLineOfThought && !showLineOfThoughtArrows) {
          continue;
        }

        const connectionStyle = getConnectionStyle(isLineOfThought);
        const parentBounds = getLiveBounds(parent);
        const nodeBounds = getLiveBounds(node);
        const endpoints = getShortestArrowEndpoints(parentBounds, nodeBounds);
        const startX = endpoints.start.x;
        const startY = endpoints.start.y;
        const endX = endpoints.end.x;
        const endY = endpoints.end.y;
        skeleton.push({
          id: arrowId,
          type: "arrow",
          x: startX,
          y: startY,
          width: endX - startX,
          height: endY - startY,
          strokeColor: connectionStyle.strokeColor,
          strokeWidth: connectionStyle.strokeWidth,
          start: {
            id: parent.elementId,
          },
          end: {
            id: node.elementId,
          },
        });
      }
    }

    const generated = convertToExcalidrawElements(skeleton, {
      regenerateIds: false,
    });

    const BG_IDS = new Set([CONCEPT_COLUMN_BG_ID, KNOWLEDGE_COLUMN_BG_ID]);
    const hasLegacyDivider = liveElementById.has(LEGACY_COLUMN_DIVIDER_ID);

    // Build updated non-bg, non-deleted elements from the current scene.
    // We drop deleted elements to prevent unbounded accumulation across redraws.
    const baseOther: (typeof currentElements)[number][] = [];
    let liveConceptBg: (typeof currentElements)[number] | null = null;
    let liveKnowledgeBg: (typeof currentElements)[number] | null = null;
    for (const element of currentElements) {
      if (element.isDeleted) continue;
      if (element.id === LEGACY_COLUMN_DIVIDER_ID && hasLegacyDivider) continue;
      if (element.id === CONCEPT_COLUMN_BG_ID) {
        liveConceptBg = newElementWith(element, {
          x: -COLUMN_BG_EXTENT_X,
          y: COLUMN_BG_Y,
          width: DIVIDER_X + COLUMN_BG_EXTENT_X,
          height: COLUMN_BG_HEIGHT,
          backgroundColor: "#fff9db",
          strokeColor: "transparent",
          roughness: 0,
          strokeWidth: 0,
          locked: true,
        });
        continue;
      }
      if (element.id === KNOWLEDGE_COLUMN_BG_ID) {
        liveKnowledgeBg = newElementWith(element, {
          x: DIVIDER_X,
          y: COLUMN_BG_Y,
          width: COLUMN_BG_EXTENT_X,
          height: COLUMN_BG_HEIGHT,
          backgroundColor: "#ebfbee",
          strokeColor: "transparent",
          roughness: 0,
          strokeWidth: 0,
          locked: true,
        });
        continue;
      }
      baseOther.push(element);
    }

    // Freshly-created bg elements from skeleton (when bgs didn't exist yet)
    const generatedBgs = generated.filter((el) => BG_IDS.has(el.id));
    const generatedNodes = generated.filter((el) => !BG_IDS.has(el.id));

    // Column bgs always go first so they render behind everything else.
    const finalBgs = generatedBgs.length > 0
      ? generatedBgs
      : [liveConceptBg, liveKnowledgeBg].filter(Boolean) as typeof generated;

    excalidrawAPI.updateScene({
      elements: [...finalBgs, ...baseOther, ...generatedNodes],
    });
    if (options?.shouldScroll !== false) {
      excalidrawAPI.scrollToContent(generated, { animate: true });
    }
  };

  const syncNodeGeometryFromCanvas = (sourceNodes: CKCanvasNode[]) => {
    if (!excalidrawAPI || !sourceNodes.length) {
      return sourceNodes;
    }

    const liveElementById = new Map(
      excalidrawAPI
        .getSceneElementsIncludingDeleted()
        .filter((element) => !element.isDeleted)
        .map((element) => [element.id, element]),
    );

    return sourceNodes.reduce<CKCanvasNode[]>((nextNodes, node) => {
      const liveNodeElement = liveElementById.get(node.elementId);
      if (!liveNodeElement) {
        return nextNodes;
      }

      nextNodes.push({
        ...node,
        x: liveNodeElement.x,
        y: liveNodeElement.y,
        width: liveNodeElement.width,
        height: liveNodeElement.height,
      });
      return nextNodes;
    }, []);
  };

  const syncNodeDerivedRefs = (sourceNodes: CKCanvasNode[]) => {
    let maxConceptIndex = 0;
    let maxKnowledgeIndex = -1;
    let maxSequence = 0;
    const nextChildCounts: Record<string, number> = {};

    for (const node of sourceNodes) {
      if (node.type === "concept") {
        const conceptIndex = parseNodeIndex(node.id, "C");
        if (conceptIndex !== null) {
          maxConceptIndex = Math.max(maxConceptIndex, conceptIndex);
        }
      }

      if (node.type === "knowledge") {
        const knowledgeIndex = parseNodeIndex(node.id, "K");
        if (knowledgeIndex !== null) {
          maxKnowledgeIndex = Math.max(maxKnowledgeIndex, knowledgeIndex);
        }
      }

      maxSequence = Math.max(maxSequence, node.sequence);

      const sourceParentIds = node.sourceParentIds.length
        ? node.sourceParentIds
        : node.parentId
        ? [node.parentId]
        : [];
      const primaryParentId = sourceParentIds[0];
      if (primaryParentId) {
        nextChildCounts[primaryParentId] =
          (nextChildCounts[primaryParentId] || 0) + 1;
      }
    }

    conceptCounterRef.current = maxConceptIndex;
    knowledgeCounterRef.current = maxKnowledgeIndex;
    sequenceRef.current = maxSequence + 1;
    childCounterRef.current = nextChildCounts;
  };

  const resolveRedirectId = (
    sourceId: string | null,
    redirectedIds: Record<string, string>,
  ) => {
    if (!sourceId) {
      return null;
    }

    const seen = new Set<string>();
    let currentId = sourceId;
    while (redirectedIds[currentId] && !seen.has(currentId)) {
      seen.add(currentId);
      currentId = redirectedIds[currentId];
    }
    return currentId;
  };

  const previewKnowledgeReorder = (
    sourceNodes: CKCanvasNode[],
    patch: CKKnowledgeReorderPatch,
  ) => {
    const removedKnowledgeIds = new Set(patch.removedKnowledgeIds);
    const redirectedIds = patch.redirectedIds;
    const reorderedKnowledgeById = new Map(
      patch.reorderedKnowledge.map((entry) => [entry.id, entry]),
    );
    const existingNodeById = new Map(
      sourceNodes.map((node) => [node.id, node]),
    );

    const remapIds = (ids: string[]) =>
      dedupeIds(
        ids
          .map((id) => resolveRedirectId(id, redirectedIds))
          .filter((id): id is string => !!id),
      );

    const conceptNodes = sourceNodes
      .filter((node) => node.type === "concept")
      .map((node) => ({
        ...node,
        parentId: resolveRedirectId(node.parentId, redirectedIds),
        sourceParentIds: remapIds(node.sourceParentIds),
      }));

    const previewKnowledgeNodes = patch.reorderedKnowledge.map((entry) => {
      const existingNode = existingNodeById.get(entry.id);
      const normalizedSourceParentIds =
        entry.sourceParentIds.length > 0
          ? remapIds(entry.sourceParentIds)
          : entry.parentId
          ? remapIds([entry.parentId])
          : [];

      if (existingNode) {
        return {
          ...existingNode,
          title: entry.title,
          desc: entry.desc,
          operationRationale: entry.operationRationale,
          parentId: resolveRedirectId(entry.parentId, redirectedIds),
          sourceParentIds: normalizedSourceParentIds,
          height: estimateNodeHeight(
            "knowledge",
            existingNode.id,
            entry.title,
            entry.desc,
          ),
        };
      }

      return {
        id: entry.id,
        type: "knowledge" as const,
        title: entry.title,
        desc: entry.desc,
        operationRationale: entry.operationRationale,
        parentId: resolveRedirectId(entry.parentId, redirectedIds),
        x: KNOWLEDGE_COLUMN_X,
        y: ROOT_Y,
        width: NODE_WIDTH,
        height: estimateNodeHeight(
          "knowledge",
          entry.id,
          entry.title,
          entry.desc,
        ),
        generated: false,
        status: "accepted" as const,
        elementId: nextElementId("node"),
        arrowId: null,
        extraArrowIds: [],
        sourceParentIds: normalizedSourceParentIds,
        sequence: sequenceRef.current++,
        createdAt: new Date().toISOString(),
      };
    });

    const unmatchedKnowledgeNodes = sourceNodes
      .filter(
        (node) =>
          node.type === "knowledge" &&
          !removedKnowledgeIds.has(node.id) &&
          !reorderedKnowledgeById.has(node.id),
      )
      .map((node) => ({
        ...node,
        parentId: resolveRedirectId(node.parentId, redirectedIds),
        sourceParentIds: remapIds(node.sourceParentIds),
      }));

    const conceptNodeById = new Map(
      conceptNodes.map((node) => [node.id, node]),
    );
    const orderedKnowledgeNodes = layoutKnowledgeNodes([
      ...previewKnowledgeNodes,
      ...unmatchedKnowledgeNodes,
    ]);
    const pendingKnowledgeNodes = [...orderedKnowledgeNodes];
    const nextNodes: CKCanvasNode[] = [];

    for (const node of sourceNodes) {
      if (node.type === "knowledge") {
        const nextKnowledgeNode = pendingKnowledgeNodes.shift();
        if (nextKnowledgeNode) {
          nextNodes.push(nextKnowledgeNode);
        }
        continue;
      }

      nextNodes.push(conceptNodeById.get(node.id) || node);
    }

    return [...nextNodes, ...pendingKnowledgeNodes];
  };

  const previewConceptReorder = (
    sourceNodes: CKCanvasNode[],
    patch: CKConceptReorderPatch,
  ) => {
    const removedConceptIds = new Set(patch.removedConceptIds);
    const redirectedIds = patch.redirectedIds;
    const reorderedConceptById = new Map(
      patch.reorderedConcepts.map((entry) => [entry.id, entry]),
    );
    const existingNodeById = new Map(
      sourceNodes.map((node) => [node.id, node]),
    );

    const remapIds = (ids: string[]) =>
      dedupeIds(
        ids
          .map((id) => resolveRedirectId(id, redirectedIds))
          .filter((id): id is string => !!id),
      );

    const previewConceptNodes = patch.reorderedConcepts.map((entry) => {
      const existingNode = existingNodeById.get(entry.id);
      const normalizedSourceParentIds =
        entry.sourceParentIds.length > 0
          ? remapIds(entry.sourceParentIds)
          : entry.parentId
          ? remapIds([entry.parentId])
          : [];

      if (existingNode) {
        return {
          ...existingNode,
          title: entry.title,
          desc: entry.desc,
          operationRationale: entry.operationRationale,
          parentId: resolveRedirectId(entry.parentId, redirectedIds),
          sourceParentIds: normalizedSourceParentIds,
          height: estimateNodeHeight(
            "concept",
            existingNode.id,
            entry.title,
            entry.desc,
          ),
        };
      }

      return {
        id: entry.id,
        type: "concept" as const,
        title: entry.title,
        desc: entry.desc,
        operationRationale: entry.operationRationale,
        parentId: resolveRedirectId(entry.parentId, redirectedIds),
        x: CONCEPT_COLUMN_X,
        y: ROOT_Y,
        width: NODE_WIDTH,
        height: estimateNodeHeight("concept", entry.id, entry.title, entry.desc),
        generated: false,
        status: "accepted" as const,
        elementId: nextElementId("node"),
        arrowId: null,
        extraArrowIds: [],
        sourceParentIds: normalizedSourceParentIds,
        sequence: sequenceRef.current++,
        createdAt: new Date().toISOString(),
      };
    });

    const unmatchedConceptNodes = sourceNodes
      .filter(
        (node) =>
          node.type === "concept" &&
          !removedConceptIds.has(node.id) &&
          !reorderedConceptById.has(node.id),
      )
      .map((node) => ({
        ...node,
        parentId: resolveRedirectId(node.parentId, redirectedIds),
        sourceParentIds: remapIds(node.sourceParentIds),
      }));

    const knowledgeNodeById = new Map(
      sourceNodes
        .filter((node) => node.type === "knowledge")
        .map((node) => [
          node.id,
          {
            ...node,
            parentId: resolveRedirectId(node.parentId, redirectedIds),
            sourceParentIds: remapIds(node.sourceParentIds),
          },
        ]),
    );
    const orderedConceptNodes = layoutConceptNodes([
      ...previewConceptNodes,
      ...unmatchedConceptNodes,
    ]);
    const pendingConceptNodes = [...orderedConceptNodes];
    const nextNodes: CKCanvasNode[] = [];

    for (const node of sourceNodes) {
      if (node.type === "concept") {
        const nextConceptNode = pendingConceptNodes.shift();
        if (nextConceptNode) {
          nextNodes.push(nextConceptNode);
        }
        continue;
      }

      nextNodes.push(knowledgeNodeById.get(node.id) || node);
    }

    return [...nextNodes, ...pendingConceptNodes];
  };

  const rebuildCanvasBindings = (sourceNodes: CKCanvasNode[]) =>
    sourceNodes.map((node) => {
      const connectionIds = node.sourceParentIds.length
        ? node.sourceParentIds
        : node.parentId
        ? [node.parentId]
        : [];
      const arrowIds = connectionIds.map(() => nextElementId("arrow"));

      return {
        ...node,
        elementId: nextElementId("node"),
        arrowId: arrowIds[0] || null,
        extraArrowIds: arrowIds.slice(1),
      };
    });

  const redrawAllNodesOnCanvas = (
    sourceNodes: CKCanvasNode[],
    options?: { previousNodesOverride?: CKCanvasNode[] },
  ) => {
    if (!excalidrawAPI) {
      return sourceNodes;
    }

    clearContextButtons();

    const previousNodes = options?.previousNodesOverride || nodesRef.current;
    const nextNodes = rebuildCanvasBindings(sourceNodes);
    const novelConceptId = novelConceptIdRef.current;
    const validationStates = { ...validationStatesRef.current };
    const nextSelectedNodeId =
      nextNodes.find((node) => node.id === selectedNodeId)?.id || null;

    if (previousNodes.length) {
      deleteNodesFromCanvas(previousNodes, { removeDivider: true });
    }

    addNodesToCanvas(nextNodes, [], { shouldScroll: false });
    nodesRef.current = nextNodes;
    syncNodeDerivedRefs(nextNodes);
    setNodes(nextNodes);

    if (
      novelConceptId &&
      nextNodes.some((node) => node.id === novelConceptId)
    ) {
      markNovelConceptOnCanvas(novelConceptId);
    }

    validationStatesRef.current = {};
    validationMarkerElementIdsRef.current = {};
    for (const [conceptId, isValid] of Object.entries(validationStates)) {
      if (
        nextNodes.some(
          (node) => node.id === conceptId && node.type === "concept",
        )
      ) {
        markValidationOnCanvas(conceptId, isValid);
      }
    }

    selectNodeOnCanvas(nextSelectedNodeId);
    return nextNodes;
  };

  const makeGeneratedNode = (
    type: CKNodeType,
    parent: CKCanvasNode,
    title: string,
    desc: string,
    operationRationale: string,
    options?: {
      sourceParentIds?: string[];
      y?: number;
    },
  ): CKCanvasNode => {
    const defaultSourceParentIds = options?.sourceParentIds?.length
      ? options.sourceParentIds
      : [parent.id];
    const primaryParentId = defaultSourceParentIds[0] || parent.id;

    const siblingCount = childCounterRef.current[primaryParentId] || 0;
    childCounterRef.current[primaryParentId] = siblingCount + 1;

    const step = Math.floor(siblingCount / 2) + 1;
    const direction = siblingCount % 2 === 0 ? 1 : -1;
    const arrowIds = defaultSourceParentIds.map(() => nextElementId("arrow"));
    const nodeId = nextNodeId(type);

    return {
      id: nodeId,
      type,
      title,
      desc,
      operationRationale,
      parentId: primaryParentId,
      x: getColumnX(type),
      y:
        options?.y ??
        (type === parent.type
          ? parent.y + direction * step * VERTICAL_GAP
          : getNextColumnY(type, nodesRef.current)),
      width: NODE_WIDTH,
      height: estimateNodeHeight(type, nodeId, title, desc),
      generated: true,
      status: "pending",
      elementId: nextElementId("node"),
      arrowId: arrowIds[0] || null,
      extraArrowIds: arrowIds.slice(1),
      sourceParentIds: defaultSourceParentIds,
      sequence: sequenceRef.current++,
      createdAt: new Date().toISOString(),
      ...(type === "concept" && { validationStatus: "undecided" as ValidationStatus }),
    };
  };

  const syncLiveInitialNodes = () => {
    if (!excalidrawAPI) {
      return;
    }

    const prevNodes = nodesRef.current;
    if (novelMarkerElementIdRef.current) {
      clearNovelMarkerFromCanvas();
    }
    const concept = confirmedInitialConcept;
    const sameSeed =
      lastInitialSeedRef.current?.title === concept?.title &&
      lastInitialSeedRef.current?.requirements === concept?.requirements;

    const shouldRenderRoot = !!concept;
    if (!shouldRenderRoot) {
      if (prevNodes.length) {
        deleteNodesFromCanvas(prevNodes, { removeDivider: true });
      }
      setNodes([]);
      nodesRef.current = [];
      selectNodeOnCanvas(null);
      setLatestDecision("");
      setLatestRationale("");
      clearValidationMarkerFromCanvas();
      clearPendingLayouts();
      lastInitialSeedRef.current = null;
      return;
    }

    if (sameSeed && prevNodes.length) {
      const liveNodes = syncNodeGeometryFromCanvas(prevNodes);
      setNodes(liveNodes);
      nodesRef.current = liveNodes;
      syncNodeDerivedRefs(liveNodes);
      return;
    }

    if (sameSeed && !prevNodes.length) {
      // Same concept but no tracked nodes. If the canvas already has visible node
      // elements (e.g. restored from DB with corrupted empty ck_nodes), don't wipe
      // them. If the canvas is truly empty, fall through to seed C0.
      const hasCanvasNodes = !!excalidrawAPI?.getSceneElements().some(
        (el) => NODE_ELEMENT_ID_PATTERN.test(el.id),
      );
      if (hasCanvasNodes) {
        return;
      }
    }

    const prevInitialNodes = syncNodeGeometryFromCanvas(prevNodes).filter(
      (node) => !node.generated,
    );

    const positionById = new Map(
      prevInitialNodes.map((node) => [node.id, { x: node.x, y: node.y }]),
    );

    conceptCounterRef.current = 0;
    knowledgeCounterRef.current = -1;
    childCounterRef.current = {};
    sequenceRef.current = 1;

    const rootTitle = concept?.title || "(initial concept)";
    const rootRequirements =
      concept?.requirements || "";

    const rootNode: CKCanvasNode = {
      id: "C0",
      type: "concept",
      title: rootTitle,
      desc: rootRequirements,
      operationRationale: "User-defined starting concept.",
      parentId: null,
      x: positionById.get("C0")?.x ?? CONCEPT_COLUMN_X,
      y: positionById.get("C0")?.y ?? ROOT_Y,
      width: NODE_WIDTH,
      height: estimateNodeHeight(
        "concept",
        "C0",
        rootTitle,
        rootRequirements,
      ),
      generated: false,
      status: "accepted",
      elementId: nextElementId("node"),
      arrowId: null,
      extraArrowIds: [],
      sourceParentIds: [],
      sequence: sequenceRef.current++,
      createdAt: new Date().toISOString(),
      validationStatus: "undecided" as ValidationStatus,
    };

    const nextNodes = [rootNode];
    redrawAllNodesOnCanvas(nextNodes);
    lastInitialSeedRef.current = {
      title: rootTitle,
      requirements: concept?.requirements || "",
    };
    selectNodeOnCanvas(
      nextNodes.some((node) => node.id === selectedNodeId)
        ? selectedNodeId
        : null,
    );
    setLatestDecision("");
    setLatestRationale("");
    clearPendingLayouts();
  };

  useEffect(() => {
    syncLiveInitialNodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedInitialConcept, excalidrawAPI]);

  const confirmInitialConcept = () => {
    if (confirmedInitialConcept) {
      return;
    }

    const title = initialConceptTitle.trim();
    if (!title) {
      toast("Enter an initial concept before confirming.");
      return;
    }

    const requirements = initialConceptRequirements.trim();
    setConfirmedInitialConcept({
      title,
      requirements,
    });
    setLatestDecision("Initial concept confirmed.");
    setLatestRationale(
      requirements || "",
    );
  };

  useEffect(() => {
    if (!excalidrawAPI || !nodesRef.current.length) {
      return;
    }

    const currentNodes = syncNodeGeometryFromCanvas(nodesRef.current);
    redrawAllNodesOnCanvas(currentNodes, {
      previousNodesOverride: currentNodes,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLineOfThoughtArrows, showNodeDescriptions, excalidrawAPI]);

  const applyPendingLayout = () => {
    if (pendingConceptLayout) {
      const baseNodes = syncNodeGeometryFromCanvas(
        pendingConceptLayoutBaseNodesRef.current || nodesRef.current,
      );
      const nextNodes = previewConceptReorder(baseNodes, pendingConceptLayout);
      redrawAllNodesOnCanvas(nextNodes, {
        previousNodesOverride: baseNodes,
      });
      clearPendingLayouts();
      setLatestDecision("Applied reordered concept layout.");
      setLatestRationale(pendingConceptLayout.rationale);
      return;
    }

    if (pendingKnowledgeLayout) {
      const baseNodes = syncNodeGeometryFromCanvas(
        pendingKnowledgeLayoutBaseNodesRef.current || nodesRef.current,
      );
      const nextNodes = previewKnowledgeReorder(
        baseNodes,
        pendingKnowledgeLayout,
      );
      redrawAllNodesOnCanvas(nextNodes, {
        previousNodesOverride: baseNodes,
      });
      clearPendingLayouts();
      setLatestDecision("Applied reordered knowledge layout.");
      setLatestRationale(pendingKnowledgeLayout.rationale);
      return;
    }

    toast("There is no pending layout to apply.");
  };

  const runOperation = async (operation: CKOperation, forceFocusNodeId?: string) => {
    const currentNodes = syncNodeGeometryFromCanvas(
      pruneDeletedGeneratedNodes(nodesRef.current),
    );

    if (!canRunOperations || !currentNodes.length) {
      toast("Confirm the initial concept before running operations.");
      return;
    }

    if (hasPendingLayout) {
      toast("Apply the pending layout before running another action.");
      return;
    }

    const focusId = forceFocusNodeId ?? selectedNodeId;
    const selectedFocusNode = focusId
      ? currentNodes.find((node) => node.id === focusId) || null
      : null;
    const requiredFocusType = getRequiredFocusType(operation);

    const latestConceptNode =
      [...currentNodes].reverse().find((node) => node.type === "concept") ||
      null;
    const latestKnowledgeNode =
      [...currentNodes].reverse().find((node) => node.type === "knowledge") ||
      null;

    let focusNode: CKCanvasNode | null;
    let expandCount: number | undefined;
    if (requiredFocusType) {
      if (!selectedFocusNode || selectedFocusNode.type !== requiredFocusType) {
        toast(
          `Select a ${requiredFocusType} node on the canvas to run ${operation}.`,
        );
        return;
      }
      focusNode = selectedFocusNode;
    } else if (operation === "DecideNovelConcept") {
      focusNode =
        (selectedFocusNode?.type === "concept" ? selectedFocusNode : null) ||
        latestConceptNode;
    } else {
      focusNode = selectedFocusNode || latestConceptNode || latestKnowledgeNode;
    }

    if (!focusNode) {
      toast("Select a node or initialize the session.");
      return;
    }

    if (operation === "ExpandConcept") {
      const countRaw = window.prompt(
        "How many concept entries to generate? (1-5)",
        "2",
      );
      if (countRaw === null) {
        return;
      }
      const parsedCount = parseExpandCount(countRaw);
      if (!parsedCount) {
        toast("Invalid count. Enter a number between 1 and 5.");
        return;
      }
      expandCount = parsedCount;
    } else if (operation === "ExpandKnowledge") {
      const countRaw = window.prompt(
        "How many knowledge entries to generate? (1-5)",
        "2",
      );
      if (countRaw === null) {
        return;
      }
      const parsedCount = parseExpandCount(countRaw);
      if (!parsedCount) {
        toast("Invalid count. Enter a number between 1 and 5.");
        return;
      }
      expandCount = parsedCount;
    }

    setBusyOperation(operation);
    try {
      const result = await runCKOperation({
        operation,
        topic: topicForAgents,
        focusEntry: {
          id: focusNode.id,
          type: focusNode.type,
          title: focusNode.title,
          desc: focusNode.desc,
          operationRationale: focusNode.operationRationale,
          parentId: focusNode.parentId,
          sourceParentIds: focusNode.sourceParentIds,
        },
        history: toContextEntries(currentNodes),
        expandCount,
      });

      if (result.reorderedIds) {
        if (operation === "ReorderKnowledge" && result.reorderPatch) {
          const previewNodes = previewKnowledgeReorder(
            currentNodes,
            result.reorderPatch,
          );
          pendingKnowledgeLayoutBaseNodesRef.current = currentNodes;
          const selectedIdStillPresent = previewNodes.some(
            (node) => node.id === selectedNodeId,
          );
          const redirectTarget =
            selectedNodeId && result.reorderPatch.redirectedIds[selectedNodeId]
              ? result.reorderPatch.redirectedIds[selectedNodeId]
              : null;
          setNodes(previewNodes);
          setPendingKnowledgeLayout(result.reorderPatch);
          setLatestDecision(
            "ReorderKnowledge prepared a new knowledge structure. Apply layout to redraw the canvas.",
          );
          setLatestRationale(result.reorderPatch.rationale);
          setSelectedNodeId(
            selectedIdStillPresent
              ? selectedNodeId
              : redirectTarget &&
                previewNodes.some((node) => node.id === redirectTarget)
              ? redirectTarget
              : null,
          );
        } else if (
          operation === "ReorderConcept" &&
          result.conceptReorderPatch
        ) {
          const previewNodes = previewConceptReorder(
            currentNodes,
            result.conceptReorderPatch,
          );
          pendingConceptLayoutBaseNodesRef.current = currentNodes;
          const selectedIdStillPresent = previewNodes.some(
            (node) => node.id === selectedNodeId,
          );
          const redirectTarget =
            selectedNodeId &&
            result.conceptReorderPatch.redirectedIds[selectedNodeId]
              ? result.conceptReorderPatch.redirectedIds[selectedNodeId]
              : null;
          setNodes(previewNodes);
          setPendingConceptLayout(result.conceptReorderPatch);
          setLatestDecision(
            "ReorderConcept prepared a new concept structure. Apply layout to redraw the canvas.",
          );
          setLatestRationale(result.conceptReorderPatch.rationale);
          setSelectedNodeId(
            selectedIdStillPresent
              ? selectedNodeId
              : redirectTarget &&
                previewNodes.some((node) => node.id === redirectTarget)
              ? redirectTarget
              : null,
          );
        } else {
          setLatestDecision(`${operation} completed.`);
          setLatestRationale("");
        }
      }

      if (result.validationDecision) {
        const { conceptId, isValid, rationale } = result.validationDecision;
        setLatestDecision(
          isValid
            ? `${conceptId} is supported by the current knowledge.`
            : `${conceptId} is not supported by the current knowledge.`,
        );
        setLatestRationale(rationale);
        selectNodeOnCanvas(conceptId);
        setConceptValidationStatus(conceptId, isValid ? "approved" : "rejected");
      }

      if (result.noveltyDecision) {
        const scoreText = result.noveltyDecision.scores
          ? ` (N ${result.noveltyDecision.scores.novelty.toFixed(
              1,
            )}, F ${result.noveltyDecision.scores.feasibility.toFixed(
              1,
            )}, U ${result.noveltyDecision.scores.usefulness.toFixed(
              1,
            )}, C ${result.noveltyDecision.scores.clarity.toFixed(1)})`
          : "";
        setLatestDecision(
          `Best concept: ${result.noveltyDecision.selectedConceptId}${scoreText}.`,
        );
        setLatestRationale(result.noveltyDecision.rationale);
        selectNodeOnCanvas(result.noveltyDecision.selectedConceptId);
        markNovelConceptOnCanvas(result.noveltyDecision.selectedConceptId);
      }

      const generatedEntries = result.generatedEntries?.length
        ? result.generatedEntries
        : result.generatedEntry
        ? [result.generatedEntry]
        : [];

      if (generatedEntries.length) {
        const knowledgeNodeById = new Map(
          currentNodes
            .filter((node) => node.type === "knowledge")
            .map((node) => [node.id, node]),
        );
        const generatedNodes = generatedEntries.map((entry) => {
          const sourceKnowledgeIds =
            operation === "CreateConcept"
              ? Array.from(new Set(entry.sourceKnowledgeIds || [])).filter(
                  (id) => knowledgeNodeById.has(id),
                )
              : [];
          const sourceKnowledgeNodes = sourceKnowledgeIds
            .map((id) => knowledgeNodeById.get(id))
            .filter((node): node is CKCanvasNode => !!node);
          const averageY =
            sourceKnowledgeNodes.length > 0
              ? sourceKnowledgeNodes.reduce((sum, node) => sum + node.y, 0) /
                sourceKnowledgeNodes.length
              : undefined;

          return makeGeneratedNode(
            entry.type,
            focusNode,
            entry.title,
            entry.desc,
            entry.operationRationale,
            sourceKnowledgeIds.length
              ? {
                  sourceParentIds: sourceKnowledgeIds,
                  y: averageY,
                }
              : undefined,
          );
        });

        const nextNodes = [...currentNodes, ...generatedNodes];
        const resultLabel =
          generatedNodes[0].type === "knowledge"
            ? "knowledge nodes"
            : "concepts";
        setLatestDecision(
          generatedNodes.length > 1
            ? `${operation} generated ${generatedNodes.length} ${resultLabel}.`
            : `${operation} generated ${generatedNodes[0].id}.`,
        );
        setLatestRationale(
          generatedNodes.length > 1
            ? generatedNodes
                .map((node) => `${node.id}: ${node.operationRationale}`)
                .join("\n\n")
            : generatedNodes[0].operationRationale,
        );
        redrawAllNodesOnCanvas(nextNodes);
        selectNodeOnCanvas(generatedNodes[generatedNodes.length - 1].id);
      }
    } catch (error) {
      toast(
        error instanceof Error ? error.message : `Failed to run ${operation}.`,
      );
    } finally {
      setBusyOperation(null);
    }
  };

  const acceptSelectedNode = () => {
    if (!selectedNode || !selectedNode.generated || !excalidrawAPI) {
      toast("Select a generated node to accept.");
      return;
    }

    const updated = { ...selectedNode, status: "accepted" as const };
    setNodes((prev) =>
      prev.map((node) => (node.id === selectedNode.id ? updated : node)),
    );

    const colors = getNodeColors(
      updated.type,
      updated.status,
      updated.id,
      updated.generated,
      updated.validationStatus,
    );
    const currentElements = excalidrawAPI.getSceneElementsIncludingDeleted();
    const nextElements = currentElements.map((element) =>
      element.id === updated.elementId
        ? newElementWith(element, {
            strokeColor: colors.strokeColor,
            backgroundColor: colors.backgroundColor,
          })
        : element,
    );
    excalidrawAPI.updateScene({ elements: nextElements });
    setLatestDecision(`${updated.id} accepted.`);
    setLatestRationale(updated.operationRationale);
  };

  const rejectSelectedNode = () => {
    if (!selectedNode || !selectedNode.generated) {
      toast("Select a generated node to reject.");
      return;
    }

    const childrenByParent = new Map<string, CKCanvasNode[]>();
    for (const node of nodes) {
      if (!node.parentId) {
        continue;
      }
      const bucket = childrenByParent.get(node.parentId) || [];
      bucket.push(node);
      childrenByParent.set(node.parentId, bucket);
    }

    const stack = [selectedNode.id];
    const idsToRemove = new Set<string>();
    while (stack.length) {
      const current = stack.pop()!;
      idsToRemove.add(current);
      const children = childrenByParent.get(current) || [];
      for (const child of children) {
        stack.push(child.id);
      }
    }

    const nodesToDelete = nodes.filter(
      (node) => idsToRemove.has(node.id) && node.generated,
    );
    deleteNodesFromCanvas(nodesToDelete);

    const nextNodes = nodes.filter((node) => !idsToRemove.has(node.id));
    setNodes(nextNodes);
    nodesRef.current = nextNodes;
    syncNodeDerivedRefs(nextNodes);
    selectNodeOnCanvas(selectedNode.parentId || null);
    setLatestDecision(`${selectedNode.id} rejected and removed.`);
    setLatestRationale("");
  };

  const confirmNewKnowledge = async () => {
    if (!excalidrawAPI || !newKnowledgeTitle.trim()) {
      return;
    }
    setPlacingKnowledge(true);
    try {
      knowledgeCounterRef.current += 1;
      const id = `K${knowledgeCounterRef.current}`;
      const title = newKnowledgeTitle.trim();
      const desc = newKnowledgeDesc.trim() || "";

      // Ask the LLM where this knowledge fits in the archipelago
      let connectedToIds: string[] = [];
      let placementRationale = "";
      try {
        const placement = await placeCKKnowledge(
          topicForAgents,
          toContextEntries(nodesRef.current),
          title,
          desc,
        );
        connectedToIds = placement.connectedToIds;
        placementRationale = placement.rationale;
      } catch {
        // Placement call failed — place as a standalone island
      }

      const arrowId = connectedToIds.length > 0 ? nextElementId("arrow") : null;
      const extraArrowIds = connectedToIds
        .slice(1)
        .map(() => nextElementId("arrow"));

      const newNode: CKCanvasNode = {
        id,
        type: "knowledge",
        title,
        desc,
        operationRationale: "",
        parentId: connectedToIds[0] ?? null,
        sourceParentIds: connectedToIds,
        x: getColumnX("knowledge"),
        y: getNextColumnY("knowledge", nodesRef.current),
        width: NODE_WIDTH,
        height: estimateNodeHeight("knowledge", id, title, desc),
        generated: false,
        status: "accepted",
        elementId: nextElementId("node"),
        arrowId,
        extraArrowIds,
        sequence: sequenceRef.current++,
        createdAt: new Date().toISOString(),
      };
      const nextNodes = [...nodesRef.current, newNode];
      setNodes(nextNodes);
      nodesRef.current = nextNodes;
      syncNodeDerivedRefs(nextNodes);
      addNodesToCanvas([newNode], nextNodes);
      setNewKnowledgeTitle("");
      setNewKnowledgeDesc("");

      if (placementRationale) {
        const connectionMsg =
          connectedToIds.length > 0
            ? `${id} connects to ${connectedToIds.join(", ")}.`
            : `${id} is a new island.`;
        setLatestDecision(connectionMsg);
        setLatestRationale(placementRationale);
      }
    } finally {
      setPlacingKnowledge(false);
    }
  };

  const confirmNewConcept = async () => {
    if (!excalidrawAPI || !newConceptTitle.trim()) {
      return;
    }
    setPlacingConcept(true);
    try {
      const id = nextNodeId("concept");
      const title = newConceptTitle.trim();
      const desc = newConceptDesc.trim() || "";

      let parentConceptId: string | null = null;
      let placementRationale = "";
      try {
        const placement = await placeCKConcept(
          topicForAgents,
          toContextEntries(nodesRef.current),
          title,
          desc,
        );
        parentConceptId = placement.parentId;
        placementRationale = placement.rationale;
      } catch {
        // Placement call failed — place as root branch
      }

      const parentNode = parentConceptId
        ? nodesRef.current.find(
            (node) => node.id === parentConceptId && node.type === "concept",
          ) || null
        : null;
      const arrowId = parentNode ? nextElementId("arrow") : null;
      const y = parentNode
        ? Math.max(
            parentNode.y + parentNode.height + VERTICAL_GAP,
            getNextColumnY("concept", nodesRef.current),
          )
        : getNextColumnY("concept", nodesRef.current);

      const newNode: CKCanvasNode = {
        id,
        type: "concept",
        title,
        desc,
        operationRationale: "",
        parentId: parentNode?.id ?? null,
        sourceParentIds: parentNode ? [parentNode.id] : [],
        x: getColumnX("concept"),
        y,
        width: NODE_WIDTH,
        height: estimateNodeHeight("concept", id, title, desc),
        generated: false,
        status: "accepted",
        elementId: nextElementId("node"),
        arrowId,
        extraArrowIds: [],
        sequence: sequenceRef.current++,
        createdAt: new Date().toISOString(),
        validationStatus: "undecided" as ValidationStatus,
      };

      const nextNodes = [...nodesRef.current, newNode];
      setNodes(nextNodes);
      nodesRef.current = nextNodes;
      syncNodeDerivedRefs(nextNodes);
      addNodesToCanvas([newNode], nextNodes);
      setNewConceptTitle("");
      setNewConceptDesc("");

      if (placementRationale) {
        const connectionMsg = parentNode
          ? `${id} connects to ${parentNode.id}.`
          : `${id} is a new root branch.`;
        setLatestDecision(connectionMsg);
        setLatestRationale(placementRationale);
      }
    } finally {
      setPlacingConcept(false);
    }
  };

  const setConceptValidationStatus = (nodeId: string, status: ValidationStatus) => {
    if (!excalidrawAPI) return;
    const updated = nodesRef.current.map((n) =>
      n.id === nodeId && n.type === "concept" ? { ...n, validationStatus: status } : n,
    );
    setNodes(updated);
    nodesRef.current = updated;
    const node = updated.find((n) => n.id === nodeId);
    if (!node || node.id === "C0") return;

    const colors = VALIDATION_COLORS[status];
    const vstatusId = `${node.elementId}-vstatus`;
    const groupId = `${node.elementId}-g`;
    const currentElements = excalidrawAPI.getSceneElementsIncludingDeleted();

    // Update card border/background
    const updatedElements = currentElements.map((el) =>
      el.id === node.elementId
        ? newElementWith(el, { strokeColor: colors.strokeColor, backgroundColor: colors.backgroundColor })
        : el,
    );

    // Upsert vstatus icon text element
    const existingVstatus = updatedElements.find((el) => el.id === vstatusId && !el.isDeleted);
    const iconX = node.x + node.width - NODE_TEXT_PADDING - BADGE_RIGHT_OFFSET - VSTATUS_FONT_SIZE - 4;
    const iconY = node.y + NODE_TEXT_PADDING;

    const finalElements = existingVstatus
      ? updatedElements.map((el) =>
          el.id === vstatusId
            ? newElementWith(el, { strokeColor: VSTATUS_COLORS[status], text: VSTATUS_ICONS[status] } as Partial<typeof el>)
            : el,
        )
      : [
          ...updatedElements,
          ...convertToExcalidrawElements([{
            id: vstatusId,
            type: "text",
            x: iconX,
            y: iconY,
            text: VSTATUS_ICONS[status],
            fontSize: VSTATUS_FONT_SIZE,
            fontFamily: FONT_FAMILY["Liberation Sans"],
            strokeColor: VSTATUS_COLORS[status],
            groupIds: [groupId],
          } as ExcalidrawElementSkeleton], { regenerateIds: false }),
        ];

    excalidrawAPI.updateScene({ elements: finalElements, captureUpdate: CaptureUpdateAction.NEVER });
  };

  const handlePush = async () => {
    if (!sessionId || !excalidrawAPI) return;
    setIsPushing(true);
    setPushFeedback(null);
    try {
      const syncedNodes = syncNodeGeometryFromCanvas(nodesRef.current);
      const elements = Array.from(excalidrawAPI.getSceneElements());
      const ckState = { ...serializeCKState(), nodes: syncedNodes };
      const { scrollX, scrollY, zoom } = excalidrawAPI.getAppState();
      await pushBoard(sessionId, elements as unknown[], ckState as unknown, {
        scrollX,
        scrollY,
        zoom,
      });
      setPushFeedback({ ok: true, msg: "Board pushed successfully." });
    } catch (err) {
      setPushFeedback({ ok: false, msg: err instanceof Error ? err.message : "Push failed." });
    } finally {
      setIsPushing(false);
    }
  };

  const handleMerge = () => {
    window.dispatchEvent(new CustomEvent("ck-merge-requested", { detail: { sessionId } }));
  };

  const getOperationDisabledReason = (operation: CKOperation) => {
    if (!canRunOperations) {
      return "Confirm the initial concept to get started.";
    }
    if (busyOperation !== null) {
      return busyOperation === operation
        ? "This action is running now."
        : "Wait for the current action to finish.";
    }
    if (hasPendingLayout) {
      return "Apply the pending layout before running another action.";
    }

    const requiredFocusType = getRequiredFocusType(operation);
    if (requiredFocusType && selectedNode?.type !== requiredFocusType) {
      return `Select a ${requiredFocusType} node on the canvas first.`;
    }

    return null;
  };

  return (
    <div className="ck-agent-panel">
      <div className="ck-agent-panel__split">
        <div className="ck-agent-pane ck-agent-pane--manual">
          <div className="ck-agent-section ck-agent-section--hero">
            <div className="ck-agent-header">
              <div>
                <div className="ck-agent-title">C-K Workspace</div>
              </div>
              <button
                type="button"
                className="ck-back-boards-btn"
                onClick={() => window.dispatchEvent(new CustomEvent("ck-back-to-boards"))}
                title="Back to my boards"
              >
                ← My boards
              </button>
            </div>
            <div className="ck-agent-hero-copy">
              Set up the initial concept, tune visibility controls, and curate
              the map content directly from this side.
            </div>
            <label className="ck-toggle-row" htmlFor="ck-toggle-line-of-thought">
              <input
                id="ck-toggle-line-of-thought"
                type="checkbox"
                checked={showLineOfThoughtArrows}
                onChange={(event) =>
                  setShowLineOfThoughtArrows(event.target.checked)
                }
              />
              <span>Show line-of-thought arrows</span>
            </label>
            <label className="ck-toggle-row" htmlFor="ck-toggle-descriptions">
              <input
                id="ck-toggle-descriptions"
                type="checkbox"
                checked={showNodeDescriptions}
                onChange={(event) =>
                  setShowNodeDescriptions(event.target.checked)
                }
              />
              <span>Show node descriptions</span>
            </label>
            <div className="ck-summary-grid">
              <div className="ck-summary-card">
                <div className="ck-summary-value">{conceptCount}</div>
                <div className="ck-summary-label">Concepts</div>
              </div>
              <div className="ck-summary-card">
                <div className="ck-summary-value">{knowledgeCount}</div>
                <div className="ck-summary-label">Knowledge</div>
              </div>
              <div className="ck-summary-card">
                <div className="ck-summary-value">{generatedCount}</div>
                <div className="ck-summary-label">Suggestions</div>
              </div>
            </div>
            <label htmlFor="ck-initial-concept-title" className="ck-agent-label">
              Initial concept
            </label>
            <input
              id="ck-initial-concept-title"
              className="ck-agent-input"
              value={initialConceptTitle}
              placeholder="Enter initial concept..."
              onChange={(event) => setInitialConceptTitle(event.target.value)}
              disabled={confirmedInitialConcept !== null}
            />
            <label
              htmlFor="ck-initial-concept-requirements"
              className="ck-agent-label"
            >
              Initial concept requirements
            </label>
            <textarea
              id="ck-initial-concept-requirements"
              className="ck-agent-input"
              value={initialConceptRequirements}
              placeholder="Enter requirements/constraints (optional)..."
              onChange={(event) => setInitialConceptRequirements(event.target.value)}
              rows={3}
              disabled={confirmedInitialConcept !== null}
            />
            <button
              className="ck-small-button ck-small-button--primary"
              type="button"
              onClick={confirmInitialConcept}
              disabled={confirmedInitialConcept !== null || !initialConceptTitle.trim()}
            >
              {confirmedInitialConcept ? "Initial concept locked" : "Confirm initial concept"}
            </button>

            <label htmlFor="ck-new-concept-title" className="ck-agent-label">
              Add concept
            </label>
            <input
              id="ck-new-concept-title"
              className="ck-agent-input"
              value={newConceptTitle}
              placeholder="Concept..."
              onChange={(e) => setNewConceptTitle(e.target.value)}
              disabled={confirmedInitialConcept === null}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  confirmNewConcept();
                }
              }}
            />
            <textarea
              className="ck-agent-input"
              value={newConceptDesc}
              placeholder="Description (optional)..."
              onChange={(e) => setNewConceptDesc(e.target.value)}
              rows={2}
              disabled={confirmedInitialConcept === null}
            />
            <button
              className="ck-small-button ck-small-button--primary"
              type="button"
              onClick={confirmNewConcept}
              disabled={
                !newConceptTitle.trim() ||
                placingConcept ||
                confirmedInitialConcept === null
              }
              aria-busy={placingConcept}
            >
              {placingConcept ? "Placing..." : "Add concept to board"}
            </button>

            <label htmlFor="ck-new-knowledge-title" className="ck-agent-label">
              Add knowledge
            </label>
            <input
              id="ck-new-knowledge-title"
              className="ck-agent-input"
              value={newKnowledgeTitle}
              placeholder="Knowledge..."
              onChange={(e) => setNewKnowledgeTitle(e.target.value)}
              disabled={confirmedInitialConcept === null}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  confirmNewKnowledge();
                }
              }}
            />
            <textarea
              className="ck-agent-input"
              value={newKnowledgeDesc}
              placeholder="Description (optional)..."
              onChange={(e) => setNewKnowledgeDesc(e.target.value)}
              rows={2}
              disabled={confirmedInitialConcept === null}
            />
            <button
              className="ck-small-button ck-small-button--primary"
              type="button"
              onClick={confirmNewKnowledge}
              disabled={
                !newKnowledgeTitle.trim() ||
                placingKnowledge ||
                confirmedInitialConcept === null
              }
              aria-busy={placingKnowledge}
            >
              {placingKnowledge ? "Placing..." : "Add to board"}
            </button>
          </div>
{/* 
          <div className="ck-agent-section">
            <div className="ck-section-header">
              <div>
                <div className="ck-agent-subtitle">Workspace Overview</div>
              </div>
              <div className="ck-status-pill is-active">Node list</div>
            </div>
            <div className="ck-node-list">
              {nodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className={`ck-node-item ${
                    selectedNodeId === node.id ? "is-selected" : ""
                  }`}
                  onClick={() => selectNodeOnCanvas(node.id)}
                >
                  <span>{node.id}</span>
                  <span>{node.title}</span>
                  {node.type === "concept" && node.id !== "C0" && node.validationStatus && (
                    <span className={`ck-node-vstatus ck-node-vstatus--${node.validationStatus}`}>
                      {VSTATUS_ICONS[node.validationStatus]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div> */}

          {sessionId && (
            <div className="ck-agent-section ck-collab-section">
              <div className="ck-agent-subtitle">Collaboration</div>
              <div className="ck-collab-buttons">
                <button
                  type="button"
                  className="ck-collab-btn ck-collab-btn--push"
                  onClick={handlePush}
                  disabled={isPushing || !nodes.length}
                  aria-busy={isPushing}
                >
                  {isPushing ? "Pushing…" : "⬆ Push"}
                </button>
                <button
                  type="button"
                  className="ck-collab-btn ck-collab-btn--merge"
                  onClick={handleMerge}
                  disabled={!nodes.length}
                >
                  ⇌ Merge
                </button>
              </div>
              {pushFeedback && (
                <div className={`ck-collab-feedback ${pushFeedback.ok ? "is-ok" : "is-err"}`}>
                  {pushFeedback.msg}
                </div>
              )}
              {/* <button
                type="button"
                className="ck-collab-btn ck-collab-btn--back"
                onClick={() => window.dispatchEvent(new CustomEvent("ck-back-to-boards"))}
              >
                ← My boards
              </button> */}
            </div>
          )}
        </div>

        <div className="ck-agent-pane ck-agent-pane--decisions">
          <div className="ck-agent-section">
            <div className="ck-section-header">
              <div>
                <div className="ck-agent-title">C-K Agents</div>
                <div className="ck-section-caption">
                  Have agents assist with expanding concepts, generating knowledge, restructuring, and validation.
                </div>
              </div>
              {/* <div className="ck-status-pill is-active">Right panel</div> */}
            </div>

            <div className="ck-section-header">
              <div>
                <div className="ck-agent-subtitle">Actions</div>
              </div>
              <div className={`ck-status-pill ${selectedNode ? "is-active" : ""}`}>
                {selectedNode
                  ? `${formatNodeTypeLabel(selectedNode.type)} ${selectedNode.id}`
                  : "No selection"}
              </div>
            </div>
            <div className="ck-hint-text">
              {selectedNode
                ? `${formatNodeTypeLabel(selectedNode.type)} ${selectedNode.id} is active. ${
                    // selectedNode.generated
                    //   ? "This is a generated suggestion."
                    //   : "This is part of the starting map." 
                    " "
                  }`
                : "Select a single concept or knowledge node on the canvas to unlock type-specific actions."}
            </div>
            {selectedNode?.type === "concept" && selectedNode.id !== "C0" && (
              <div className="ck-validation-row">
                <span className="ck-validation-label">Validation</span>
                <div className="ck-validation-pills">
                  {(["undecided", "approved", "rejected"] as ValidationStatus[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`ck-validation-pill ck-validation-pill--${s} ${
                        (selectedNode.validationStatus ?? "undecided") === s ? "is-active" : ""
                      }`}
                      onClick={() => setConceptValidationStatus(selectedNode.id, s)}
                    >
                      {s === "approved" ? "approved" : s === "rejected" ? "rejected" : "undecided"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {hasPendingLayout ? (
              <div className="ck-inline-banner is-warning">
                A new layout is ready. Apply layout to sync the canvas before
                running more actions.
              </div>
            ) : null}
            {ACTION_GROUPS.map((group) => (
              <div key={group.label} className="ck-action-group">
                <div className="ck-action-group__label">{group.label}</div>
                <div className="ck-actions-grid">
                  {group.operations.map((operation) => {
                    const disabledReason = getOperationDisabledReason(operation);
                    const requiredFocusType = getRequiredFocusType(operation);
                    const isBusy = busyOperation === operation;
                    const isMatched =
                      requiredFocusType !== null &&
                      selectedNode?.type === requiredFocusType;
                    const theme = OPERATION_THEME[operation];

                    return (
                      <button
                        key={operation}
                        type="button"
                        className={[
                          "ck-action-button",
                          `ck-action-button--${theme}`,
                          isBusy ? "is-busy" : "",
                          isMatched ? "is-matched" : "",
                          disabledReason ? "is-disabled" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        disabled={disabledReason !== null}
                        onClick={() => runOperation(operation)}
                        aria-busy={isBusy}
                        title={disabledReason || OPERATION_DESCRIPTIONS[operation]}
                      >
                        <span className="ck-action-button__top">
                          <span className="ck-action-button__label">
                            {isBusy
                              ? `Running: ${OPERATION_LABELS[operation]}...`
                              : OPERATION_LABELS[operation]}
                          </span>
                        </span>
                        <span className="ck-action-button__desc">
                          {OPERATION_DESCRIPTIONS[operation]}
                        </span>
                        {disabledReason ? (
                          <span className="ck-action-button__meta">
                            {disabledReason}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="ck-agent-section">
            <div className="ck-section-header">
              <div>
                <div className="ck-agent-subtitle">Decision</div>
                <div className="ck-section-caption">
                  Review the latest agent output before accepting or rejecting it.
                </div>
              </div>
              <div
                className={`ck-status-pill ${
                  hasPendingLayout || latestDecision ? "is-active" : ""
                }`}
              >
                {hasPendingLayout
                  ? "Layout pending"
                  : latestDecision
                  ? "Updated"
                  : "Waiting"}
              </div>
            </div>
            <div className="ck-decision-box">
              <div className="ck-decision-summary">
                {latestDecision || "Run an operation to see agent decisions."}
              </div>
              {latestRationale ? (
                <div className="ck-decision-rationale">{latestRationale}</div>
              ) : null}
            </div>
            <div className="ck-accept-reject-row">
              <button
                type="button"
                className="ck-small-button ck-small-button--primary"
                onClick={applyPendingLayout}
                disabled={!hasPendingLayout}
              >
                Apply layout
              </button>
              <button
                type="button"
                className="ck-small-button ck-small-button--success"
                onClick={acceptSelectedNode}
                disabled={!selectedNode?.generated || hasPendingLayout}
              >
                Accept selected
              </button>
              <button
                type="button"
                className="ck-small-button ck-small-button--danger"
                onClick={rejectSelectedNode}
                disabled={!selectedNode?.generated || hasPendingLayout}
              >
                Reject selected
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
