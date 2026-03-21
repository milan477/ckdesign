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
  type CKEntryContext,
  type CKKnowledgeReorderPatch,
  type CKNodeType,
  type CKOperation,
} from "../services/ckAgent";

const NODE_WIDTH = 320;
const NODE_HEIGHT = 160;
const HORIZONTAL_GAP = 430;
const VERTICAL_GAP = 220;
const DIVIDER_X = 800;
const CONCEPT_COLUMN_X = DIVIDER_X - HORIZONTAL_GAP / 2 - NODE_WIDTH / 2;
const KNOWLEDGE_COLUMN_X = DIVIDER_X + HORIZONTAL_GAP / 2 - NODE_WIDTH / 2;
const ROOT_Y = 240;
const LABEL_FONT_SIZE = 14;
const MAX_LABEL_LINE_CHARS = 32;
const LABEL_LINE_HEIGHT_ESTIMATE = 23;
const LABEL_VERTICAL_PADDING = 36;
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

type NodeStatus = "pending" | "accepted";

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
};

const ACTIONS: readonly CKOperation[] = [
  "CreateConcept",
  "CreateKnowledge",
  "ExpandConcept",
  "ExpandKnowledge",
  "ReorderConcept",
  "ReorderKnowledge",
  "ValidateConcept",
  "DecideNovelConcept",
];

const OPERATION_LABELS: Record<CKOperation, string> = {
  CreateConcept: "CreateConcept()",
  ExpandConcept: "ExpandConcept()",
  ExpandKnowledge: "ExpandKnowledge()",
  ReorderConcept: "ReorderConcept()",
  DecideNovelConcept: "DecideNovelConcept()",
  CreateKnowledge: "CreateKnowledge()",
  ReorderKnowledge: "ReorderKnowledge()",
  ValidateConcept: "ValidateConcept()",
};

const getNodeColors = (
  type: CKNodeType,
  _status: NodeStatus,
  _nodeId?: string,
  _generated?: boolean,
) => {
  if (type === "concept") {
    return {
      strokeColor: "#f08c00",
      backgroundColor: "#fff4e6",
    };
  }
  return {
    // Keep knowledge entries on the previous blue style.
    strokeColor: "#1864ab",
    backgroundColor: "#e7f5ff",
  };
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

const buildLabelText = (
  type: CKNodeType,
  id: string,
  title: string,
  desc: string,
) => {
  const { cleanTitle, cleanDesc } = getLabelFields(title, desc);
  const wrappedTitle = wrapText(cleanTitle, MAX_LABEL_LINE_CHARS)
    .split("\n")
    .map((line, idx) => (idx === 0 ? `Title: ${line}` : line))
    .join("\n");
  const wrappedDesc = wrapText(cleanDesc, MAX_LABEL_LINE_CHARS)
    .split("\n")
    .map((line, idx) => (idx === 0 ? `Description: ${line}` : line))
    .join("\n");
  return `${type.toUpperCase()} ${id}\n\n${wrappedTitle}\n\n${wrappedDesc}`;
};

const toLabelText = (node: CKCanvasNode) =>
  buildLabelText(node.type, node.id, node.title, node.desc);

const estimateNodeHeight = (
  type: CKNodeType,
  id: string,
  title: string,
  desc: string,
) => {
  const lines = buildLabelText(type, id, title, desc).split("\n").length;
  const estimatedHeight =
    lines * LABEL_LINE_HEIGHT_ESTIMATE + LABEL_VERTICAL_PADDING;
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
  }));

const reorderByIds = (
  nodes: CKCanvasNode[],
  orderedIds: string[],
  type: CKNodeType,
) => {
  const orderMap = new Map(orderedIds.map((id, idx) => [id, idx]));
  const sortedTargets = nodes
    .filter((node) => node.type === type)
    .sort((a, b) => {
      const aIndex = orderMap.get(a.id);
      const bIndex = orderMap.get(b.id);
      if (aIndex !== undefined && bIndex !== undefined) {
        return aIndex - bIndex;
      }
      if (aIndex !== undefined) {
        return -1;
      }
      if (bIndex !== undefined) {
        return 1;
      }
      return a.sequence - b.sequence;
    });

  let pointer = 0;
  return nodes.map((node) =>
    node.type === type ? sortedTargets[pointer++] : node,
  );
};

const layoutKnowledgeNodes = (knowledgeNodes: CKCanvasNode[]) =>
  knowledgeNodes.map((node, index, allNodes) => ({
    ...node,
    y:
      ROOT_Y -
      ((allNodes.length - 1) * VERTICAL_GAP) / 2 +
      index * VERTICAL_GAP,
  }));

const dedupeIds = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

const areStringArraysEqual = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

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

export const CKAgentPanel = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}) => {
  const [initialConcept, setInitialConcept] = useState("");
  const [initialKnowledge, setInitialKnowledge] = useState<string[]>([""]);
  const [nodes, setNodes] = useState<CKCanvasNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [latestDecision, setLatestDecision] = useState("");
  const [latestRationale, setLatestRationale] = useState("");
  const [busyOperation, setBusyOperation] = useState<CKOperation | null>(null);
  const [pendingKnowledgeLayout, setPendingKnowledgeLayout] =
    useState<CKKnowledgeReorderPatch | null>(null);

  const conceptCounterRef = useRef(0);
  const knowledgeCounterRef = useRef(-1);
  const elementCounterRef = useRef(1);
  const sequenceRef = useRef(1);
  const childCounterRef = useRef<Record<string, number>>({});
  const nodesRef = useRef<CKCanvasNode[]>([]);
  const lastInitialSeedRef = useRef<{
    concept: string;
    knowledge: string[];
  } | null>(null);
  const novelConceptIdRef = useRef<string | null>(null);
  const novelMarkerElementIdRef = useRef<string | null>(null);
  const validationMarkerElementIdsRef = useRef<Record<string, string>>({});
  const validationStatesRef = useRef<Record<string, boolean>>({});

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  );
  const canRunOperations =
    initialConcept.trim().length > 0 &&
    initialKnowledge.some((entry) => entry.trim().length > 0);
  const hasPendingKnowledgeLayout = pendingKnowledgeLayout !== null;

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const syncSelectedNodeFromCanvas = (
    selectedElementIds: Readonly<Record<string, true>> | undefined,
  ) => {
    const selectedIds = new Set(Object.keys(selectedElementIds || {}));
    const matchedNodes = nodesRef.current.filter((node) =>
      selectedIds.has(node.elementId),
    );

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
          ? { [nextSelectedNode.elementId]: true }
          : {},
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  };

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    syncSelectedNodeFromCanvas(excalidrawAPI.getAppState().selectedElementIds);

    return excalidrawAPI.onChange((_elements, appState) => {
      syncSelectedNodeFromCanvas(appState.selectedElementIds);
    });
  }, [excalidrawAPI]);

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    syncSelectedNodeFromCanvas(excalidrawAPI.getAppState().selectedElementIds);
  }, [excalidrawAPI, nodes]);

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
    if (
      novelConceptIdRef.current &&
      !pruned.some((node) => node.id === novelConceptIdRef.current)
    ) {
      clearNovelMarkerFromCanvas();
    }
    for (const [conceptId, markerId] of Object.entries(
      validationMarkerElementIdsRef.current,
    )) {
      if (
        !pruned.some((node) => node.id === conceptId && node.type === "concept")
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

    if (pruned.length !== sourceNodes.length) {
      setNodes(pruned);
      setSelectedNodeId((prevSelected) =>
        pruned.some((node) => node.id === prevSelected) ? prevSelected : null,
      );
      nodesRef.current = pruned;
      syncNodeDerivedRefs(pruned);
      setPendingKnowledgeLayout(null);
    }

    return pruned;
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
      );
      const labelText = toLabelText(node);
      skeleton.push({
        id: node.elementId,
        type: "rectangle",
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        backgroundColor: colors.backgroundColor,
        strokeColor: colors.strokeColor,
        label: {
          text: labelText,
          fontSize: LABEL_FONT_SIZE,
          fontFamily: FONT_FAMILY.Nunito,
        },
      });

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
        const parentBounds = getLiveBounds(parent);
        const nodeBounds = getLiveBounds(node);
        const parentCenterX = parentBounds.x + parentBounds.width / 2;
        const nodeCenterX = nodeBounds.x + nodeBounds.width / 2;
        const leftToRight = parentCenterX <= nodeCenterX;
        const startX = leftToRight
          ? parentBounds.x + parentBounds.width
          : parentBounds.x;
        const startY = parentBounds.y + parentBounds.height / 2;
        const endX = leftToRight
          ? nodeBounds.x
          : nodeBounds.x + nodeBounds.width;
        const endY = nodeBounds.y + nodeBounds.height / 2;
        skeleton.push({
          id: arrowId,
          type: "arrow",
          x: startX,
          y: startY,
          width: endX - startX,
          height: endY - startY,
          strokeColor: "#495057",
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
    const hasLegacyDivider = liveElementById.has(LEGACY_COLUMN_DIVIDER_ID);
    const baseElements = currentElements.map((element) => {
      if (element.id === LEGACY_COLUMN_DIVIDER_ID && hasLegacyDivider) {
        return newElementWith(element, { isDeleted: true });
      }
      if (element.id === CONCEPT_COLUMN_BG_ID && !element.isDeleted) {
        return newElementWith(element, {
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
      if (element.id === KNOWLEDGE_COLUMN_BG_ID && !element.isDeleted) {
        return newElementWith(element, {
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
      return element;
    });
    excalidrawAPI.updateScene({
      elements: [...baseElements, ...generated],
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

  const redrawAllNodesOnCanvas = (sourceNodes: CKCanvasNode[]) => {
    if (!excalidrawAPI) {
      return sourceNodes;
    }

    const previousNodes = nodesRef.current;
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
    const concept = initialConcept.trim();
    const knowledgeEntries = initialKnowledge
      .map((entry) => entry.trim())
      .filter(Boolean);
    const sameSeed =
      lastInitialSeedRef.current?.concept === concept &&
      areStringArraysEqual(
        lastInitialSeedRef.current?.knowledge || [],
        knowledgeEntries,
      );

    const shouldRenderRoot = concept.length > 0 || knowledgeEntries.length > 0;
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
      setPendingKnowledgeLayout(null);
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

    const prevInitialNodes = syncNodeGeometryFromCanvas(prevNodes).filter(
      (node) => !node.generated,
    );

    const positionById = new Map(
      prevInitialNodes.map((node) => [node.id, { x: node.x, y: node.y }]),
    );

    conceptCounterRef.current = 0;
    knowledgeCounterRef.current = Math.max(-1, knowledgeEntries.length - 1);
    childCounterRef.current = {};
    sequenceRef.current = 1;

    const rootNode: CKCanvasNode = {
      id: "C0",
      type: "concept",
      title: concept || "(initial concept)",
      desc: "Initial concept provided by user.",
      operationRationale: "User-defined starting concept.",
      parentId: null,
      x: positionById.get("C0")?.x ?? CONCEPT_COLUMN_X,
      y: positionById.get("C0")?.y ?? ROOT_Y,
      width: NODE_WIDTH,
      height: estimateNodeHeight(
        "concept",
        "C0",
        concept || "(initial concept)",
        "Initial concept provided by user.",
      ),
      generated: false,
      status: "accepted",
      elementId: nextElementId("node"),
      arrowId: null,
      extraArrowIds: [],
      sourceParentIds: [],
      sequence: sequenceRef.current++,
    };

    const knowledgeNodes = knowledgeEntries.map((entry, index) => {
      const id = `K${index}`;
      return {
        id,
        type: "knowledge" as const,
        title: entry,
        desc: "Initial knowledge provided by user.",
        operationRationale: "User-defined initial knowledge.",
        parentId: null,
        x: positionById.get(id)?.x ?? KNOWLEDGE_COLUMN_X,
        y:
          positionById.get(id)?.y ??
          ROOT_Y -
            ((knowledgeEntries.length - 1) * VERTICAL_GAP) / 2 +
            index * VERTICAL_GAP,
        width: NODE_WIDTH,
        height: estimateNodeHeight(
          "knowledge",
          id,
          entry,
          "Initial knowledge provided by user.",
        ),
        generated: false,
        status: "accepted" as const,
        elementId: nextElementId("node"),
        arrowId: null,
        extraArrowIds: [],
        sourceParentIds: [],
        sequence: sequenceRef.current++,
      };
    });

    childCounterRef.current[rootNode.id] = knowledgeNodes.length;

    const nextNodes = [rootNode, ...knowledgeNodes];
    redrawAllNodesOnCanvas(nextNodes);
    lastInitialSeedRef.current = {
      concept,
      knowledge: knowledgeEntries,
    };
    selectNodeOnCanvas(
      nextNodes.some((node) => node.id === selectedNodeId)
        ? selectedNodeId
        : null,
    );
    setLatestDecision("");
    setLatestRationale("");
    setPendingKnowledgeLayout(null);
  };

  useEffect(() => {
    syncLiveInitialNodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConcept, initialKnowledge, excalidrawAPI]);

  const applyPendingKnowledgeLayout = () => {
    if (!pendingKnowledgeLayout) {
      toast("There is no pending knowledge layout to apply.");
      return;
    }

    const nextNodes = previewKnowledgeReorder(
      nodesRef.current,
      pendingKnowledgeLayout,
    );
    redrawAllNodesOnCanvas(nextNodes);
    setPendingKnowledgeLayout(null);
    setLatestDecision("Applied reordered knowledge layout.");
    setLatestRationale(pendingKnowledgeLayout.rationale);
  };

  const runOperation = async (operation: CKOperation) => {
    const currentNodes = syncNodeGeometryFromCanvas(
      pruneDeletedGeneratedNodes(nodesRef.current),
    );

    if (!canRunOperations || !currentNodes.length) {
      toast("Add initial concept and at least one knowledge entry.");
      return;
    }

    if (hasPendingKnowledgeLayout) {
      toast(
        "Apply the pending knowledge layout before running another action.",
      );
      return;
    }

    const selectedFocusNode = selectedNodeId
      ? currentNodes.find((node) => node.id === selectedNodeId) || null
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
        topic: initialConcept.trim(),
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
        const targetType =
          operation === "ReorderConcept" ? "concept" : "knowledge";
        if (operation === "ReorderKnowledge" && result.reorderPatch) {
          const previewNodes = previewKnowledgeReorder(
            currentNodes,
            result.reorderPatch,
          );
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
        } else {
          setNodes((prev) =>
            reorderByIds(prev, result.reorderedIds!, targetType),
          );
          setLatestDecision(`${operation} completed.`);
          setLatestRationale("");
        }
      }

      if (result.validationDecision) {
        setLatestDecision(
          result.validationDecision.isValid
            ? `${result.validationDecision.conceptId} is supported by the current knowledge.`
            : `${result.validationDecision.conceptId} is not supported by the current knowledge.`,
        );
        setLatestRationale(result.validationDecision.rationale);
        selectNodeOnCanvas(result.validationDecision.conceptId);
        markValidationOnCanvas(
          result.validationDecision.conceptId,
          result.validationDecision.isValid,
        );
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

  const addKnowledgeInput = () => {
    setInitialKnowledge((prev) => [...prev, ""]);
  };

  const removeKnowledgeInput = (index: number) => {
    setInitialKnowledge((prev) => {
      if (prev.length === 1) {
        return prev;
      }
      return prev.filter((_, idx) => idx !== index);
    });
  };

  return (
    <div className="ck-agent-panel">
      <div className="ck-agent-section">
        <div className="ck-agent-title">C-K Agents</div>
        <label htmlFor="ck-initial-concept">Initial concept</label>
        <textarea
          id="ck-initial-concept"
          className="ck-agent-input"
          value={initialConcept}
          placeholder="Enter one initial concept..."
          onChange={(event) => setInitialConcept(event.target.value)}
          rows={3}
        />

        <label>Initial knowledge</label>
        {initialKnowledge.map((entry, index) => (
          <div key={`knowledge-${index}`} className="ck-knowledge-row">
            <textarea
              className="ck-agent-input"
              value={entry}
              placeholder={`Knowledge ${index + 1}`}
              onChange={(event) =>
                setInitialKnowledge((prev) =>
                  prev.map((item, idx) =>
                    idx === index ? event.target.value : item,
                  ),
                )
              }
              rows={2}
            />
            <button
              className="ck-knowledge-remove"
              type="button"
              onClick={() => removeKnowledgeInput(index)}
              title="Remove knowledge input"
            >
              x
            </button>
          </div>
        ))}
        <button
          className="ck-small-button"
          type="button"
          onClick={addKnowledgeInput}
        >
          + Add knowledge
        </button>
        <div className="ck-hint-text">
          Excalidraw rectangles for initial concept and knowledge are created
          live while typing.
        </div>
      </div>

      <div className="ck-agent-section">
        <div className="ck-agent-subtitle">Actions</div>
        <div className="ck-hint-text">
          {selectedNode
            ? `Selected ${selectedNode.type}: ${selectedNode.id}.`
            : "Select a single canvas node to enable type-specific actions."}
        </div>
        {hasPendingKnowledgeLayout ? (
          <div className="ck-hint-text">
            A reordered knowledge layout is ready. Apply layout to sync the
            canvas before running more actions.
          </div>
        ) : null}
        <div className="ck-actions-grid">
          {ACTIONS.map((operation) => (
            <button
              key={operation}
              type="button"
              className="ck-action-button"
              disabled={
                !canRunOperations ||
                busyOperation !== null ||
                hasPendingKnowledgeLayout ||
                (getRequiredFocusType(operation) !== null &&
                  selectedNode?.type !== getRequiredFocusType(operation))
              }
              onClick={() => runOperation(operation)}
            >
              {busyOperation === operation
                ? `Running ${operation}...`
                : OPERATION_LABELS[operation]}
            </button>
          ))}
        </div>
      </div>

      <div className="ck-agent-section">
        <div className="ck-agent-subtitle">Decision</div>
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
            className="ck-small-button"
            onClick={applyPendingKnowledgeLayout}
            disabled={!hasPendingKnowledgeLayout}
          >
            Apply layout
          </button>
          <button
            type="button"
            className="ck-small-button"
            onClick={acceptSelectedNode}
            disabled={!selectedNode?.generated || hasPendingKnowledgeLayout}
          >
            Accept selected
          </button>
          <button
            type="button"
            className="ck-small-button"
            onClick={rejectSelectedNode}
            disabled={!selectedNode?.generated || hasPendingKnowledgeLayout}
          >
            Reject selected
          </button>
        </div>
      </div>

      <div className="ck-agent-section">
        <div className="ck-agent-subtitle">Nodes</div>
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
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
