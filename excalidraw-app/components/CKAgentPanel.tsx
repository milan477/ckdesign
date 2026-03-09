import { useEffect, useMemo, useRef, useState } from "react";
import {
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import {
  runCKOperation,
  type CKAgentMessage,
  type CKEntryContext,
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
const COLUMN_DIVIDER_ID = "ck-column-divider";
const NOVEL_MARKER_SIZE = 120;
const NOVEL_MARKER_OFFSET_X = 70;
const NOVEL_MARKER_OFFSET_Y = 90;

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

type TranscriptItem = CKAgentMessage & {
  id: number;
};

const ACTIONS: readonly CKOperation[] = [
  "CreateConcept",
  "ExpandConcept",
  "ExpandKnowledge",
  "ReorderConcept",
  "DecideNovelConcept",
  "CreateKnowledge",
  "ReorderKnowledge",
  "ValidateConcept",
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

const getNodeColors = (type: CKNodeType, _status: NodeStatus, nodeId?: string) => {
  // C0 (initial concept) is blue
  if (type === "concept" && nodeId === "C0") {
    return {
      strokeColor: "#1864ab",
      backgroundColor: "#e7f5ff",
    };
  }
  // All other concepts are yellow
  if (type === "concept") {
    return {
      strokeColor: "#c06c00",
      backgroundColor: "#fff9db",
    };
  }
  // Knowledge is green
  return {
    strokeColor: "#2f9e44",
    backgroundColor: "#ebfbee",
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
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [latestDecision, setLatestDecision] = useState("");
  const [busyOperation, setBusyOperation] = useState<CKOperation | null>(null);

  const conceptCounterRef = useRef(1);
  const knowledgeCounterRef = useRef(0);
  const elementCounterRef = useRef(1);
  const sequenceRef = useRef(1);
  const childCounterRef = useRef<Record<string, number>>({});
  const transcriptCounterRef = useRef(1);
  const nodesRef = useRef<CKCanvasNode[]>([]);
  const novelConceptIdRef = useRef<string | null>(null);
  const novelMarkerElementIdRef = useRef<string | null>(null);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  );
  const canRunOperations =
    initialConcept.trim().length > 0 &&
    initialKnowledge.some((entry) => entry.trim().length > 0);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const pushTranscript = (messages: CKAgentMessage[]) => {
    if (!messages.length) {
      return;
    }

    setTranscript((prev) => [
      ...prev,
      ...messages.map((message) => ({
        ...message,
        id: transcriptCounterRef.current++,
      })),
    ]);
  };

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

  const syncCounterWithNodeId = (id: string) => {
    const match = /^([CK])(\d+)$/i.exec(id.trim());
    if (!match) {
      return;
    }
    const prefix = match[1].toUpperCase();
    const sequenceNumber = Number.parseInt(match[2], 10);
    if (!Number.isFinite(sequenceNumber)) {
      return;
    }
    if (prefix === "C") {
      conceptCounterRef.current = Math.max(
        conceptCounterRef.current,
        sequenceNumber,
      );
      return;
    }
    knowledgeCounterRef.current = Math.max(
      knowledgeCounterRef.current,
      sequenceNumber,
    );
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

    if (pruned.length !== sourceNodes.length) {
      setNodes(pruned);
      setSelectedNodeId((prevSelected) =>
        pruned.some((node) => node.id === prevSelected) ? prevSelected : null,
      );
      nodesRef.current = pruned;
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
      element.id === markerId ? newElementWith(element, { isDeleted: true }) : element,
    );
    excalidrawAPI.updateScene({ elements: updatedElements });
    novelConceptIdRef.current = null;
    novelMarkerElementIdRef.current = null;
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
          updatedElements[i] = newElementWith(updatedElements[i], { isDeleted: true });
          break;
        }
      }
    }

    const liveNodeElement = currentElements.find(
      (element) => element.id === targetNode.elementId && !element.isDeleted,
    );
    const markerX = (liveNodeElement?.x ?? targetNode.x) - NOVEL_MARKER_OFFSET_X;
    const markerY = (liveNodeElement?.y ?? targetNode.y) - NOVEL_MARKER_OFFSET_Y;
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

  const deleteNodesFromCanvas = (nodesToDelete: CKCanvasNode[]) => {
    if (!excalidrawAPI || !nodesToDelete.length) {
      return;
    }

    const ids = new Set<string>();
    // Always clean up the divider when clearing nodes so it can be re-created
    ids.add(COLUMN_DIVIDER_ID);
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

    // Add divider line if not already live on canvas
    const hasLiveDivider = liveElementById.has(COLUMN_DIVIDER_ID);
    if (!hasLiveDivider) {
      skeleton.push({
        id: COLUMN_DIVIDER_ID,
        type: "line",
        x: DIVIDER_X,
        y: -10000,
        width: 0,
        height: 20000,
        strokeColor: "#868e96",
      });
    }

    for (const node of nodesToAdd) {
      const colors = getNodeColors(node.type, node.status, node.id);
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
            x: startX,
            y: startY,
          },
          end: {
            id: node.elementId,
            x: endX,
            y: endY,
          },
        });
      }
    }

    const generated = convertToExcalidrawElements(skeleton, {
      regenerateIds: false,
    });
    excalidrawAPI.updateScene({
      elements: [...currentElements, ...generated],
    });
    if (options?.shouldScroll !== false) {
      excalidrawAPI.scrollToContent(generated, { animate: true });
    }
  };

  const makeGeneratedNode = (
    type: CKNodeType,
    parent: CKCanvasNode,
    title: string,
    desc: string,
    operationRationale: string,
    options?: {
      id?: string;
      sourceParentIds?: string[];
      x?: number;
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
    const providedId = options?.id?.trim();
    const hasProvidedId =
      !!providedId && !nodesRef.current.some((node) => node.id === providedId);
    const nodeId = hasProvidedId ? providedId! : nextNodeId(type);
    if (hasProvidedId) {
      syncCounterWithNodeId(nodeId);
    }

    return {
      id: nodeId,
      type,
      title,
      desc,
      operationRationale,
      parentId: primaryParentId,
      x: options?.x ?? getColumnX(type),
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
    const prevInitialNodes = prevNodes.filter((node) => !node.generated);
    if (novelMarkerElementIdRef.current) {
      clearNovelMarkerFromCanvas();
    }
    const concept = initialConcept.trim();
    const knowledgeEntries = initialKnowledge
      .map((entry) => entry.trim())
      .filter(Boolean);

    const shouldRenderRoot = concept.length > 0 || knowledgeEntries.length > 0;
    if (!shouldRenderRoot) {
      if (prevNodes.length) {
        deleteNodesFromCanvas(prevNodes);
      }
      setNodes([]);
      setSelectedNodeId(null);
      setLatestDecision("");
      return;
    }

    const positionById = new Map(
      prevInitialNodes.map((node) => [node.id, { x: node.x, y: node.y }]),
    );

    conceptCounterRef.current = 1;
    knowledgeCounterRef.current = knowledgeEntries.length;
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
      const id = `K${index + 1}`;
      return {
        id,
        type: "knowledge" as const,
        title: entry,
        desc: "Initial knowledge provided by user.",
        operationRationale: "User-defined initial knowledge.",
        parentId: rootNode.id,
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
    if (prevNodes.length) {
      deleteNodesFromCanvas(prevNodes);
    }
    addNodesToCanvas(nextNodes, [], { shouldScroll: false });
    setNodes(nextNodes);
    setSelectedNodeId((prevSelected) =>
      nextNodes.some((node) => node.id === prevSelected)
        ? prevSelected
        : rootNode.id,
    );
    setTranscript([]);
    setLatestDecision("");
  };

  useEffect(() => {
    syncLiveInitialNodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConcept, initialKnowledge, excalidrawAPI]);

  const runOperation = async (operation: CKOperation) => {
    const currentNodes = pruneDeletedGeneratedNodes(nodesRef.current);

    if (!canRunOperations || !currentNodes.length) {
      toast("Add initial concept and at least one knowledge entry.");
      return;
    }

    const selectedFocusNode =
      selectedNodeId
        ? currentNodes.find((node) => node.id === selectedNodeId) || null
        : null;
    const focusNode =
      operation === "ExpandConcept" ||
      operation === "DecideNovelConcept" ||
      operation === "CreateKnowledge"
        ? (selectedFocusNode?.type === "concept" ? selectedFocusNode : null) ||
          [...currentNodes].reverse().find((node) => node.type === "concept") ||
          null
        : selectedFocusNode ||
          [...currentNodes].reverse().find((node) => node.type === "concept") ||
          null;
    if (!focusNode) {
      toast("Select a node or initialize the session.");
      return;
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
        },
        history: toContextEntries(currentNodes),
      });

      pushTranscript(result.dialogue);

      if (result.reorderedIds) {
        const targetType =
          operation === "ReorderConcept" ? "concept" : "knowledge";
        setNodes((prev) =>
          reorderByIds(prev, result.reorderedIds!, targetType),
        );
        setLatestDecision(`${operation} completed.`);
      }

      if (result.noveltyDecision) {
        const scoreText = result.noveltyDecision.scores
          ? ` (N ${result.noveltyDecision.scores.novelty.toFixed(1)}, F ${result.noveltyDecision.scores.feasibility.toFixed(1)}, U ${result.noveltyDecision.scores.usefulness.toFixed(1)}, C ${result.noveltyDecision.scores.clarity.toFixed(1)})`
          : "";
        setLatestDecision(
          `Best concept: ${result.noveltyDecision.selectedConceptId}${scoreText}. ${result.noveltyDecision.rationale}`,
        );
        setSelectedNodeId(result.noveltyDecision.selectedConceptId);
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
                  id: entry.id,
                  sourceParentIds: sourceKnowledgeIds,
                  x: getColumnX(entry.type),
                  y: averageY,
                }
              : entry.id
              ? { id: entry.id }
              : undefined,
          );
        });

        setNodes((prev) => [...prev, ...generatedNodes]);
        nodesRef.current = [...currentNodes, ...generatedNodes];
        setSelectedNodeId(generatedNodes[generatedNodes.length - 1].id);
        setLatestDecision(
          generatedNodes.length > 1
            ? `${operation} generated ${generatedNodes.length} concepts.`
            : generatedNodes[0].operationRationale,
        );
        addNodesToCanvas(generatedNodes, currentNodes);
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

    const colors = getNodeColors(updated.type, updated.status, updated.id);
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

    setNodes((prev) => prev.filter((node) => !idsToRemove.has(node.id)));
    setSelectedNodeId(selectedNode.parentId || null);
    setLatestDecision(`${selectedNode.id} rejected and removed.`);
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
        <div className="ck-actions-grid">
          {ACTIONS.map((operation) => (
            <button
              key={operation}
              type="button"
              className="ck-action-button"
              disabled={!canRunOperations || busyOperation !== null}
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
          {latestDecision || "Run an operation to see agent decisions."}
        </div>
        <div className="ck-accept-reject-row">
          <button
            type="button"
            className="ck-small-button"
            onClick={acceptSelectedNode}
            disabled={!selectedNode?.generated}
          >
            Accept selected
          </button>
          <button
            type="button"
            className="ck-small-button"
            onClick={rejectSelectedNode}
            disabled={!selectedNode?.generated}
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
              onClick={() => setSelectedNodeId(node.id)}
            >
              <span>{node.id}</span>
              <span>{node.title}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="ck-agent-section">
        <div className="ck-agent-subtitle">Agent dialogue</div>
        <div className="ck-transcript">
          {transcript.length === 0 ? (
            <div className="ck-transcript-empty">
              Concept and knowledge agent messages will appear here.
            </div>
          ) : (
            transcript.map((message) => (
              <div key={message.id} className="ck-transcript-line">
                <strong>{message.speaker}</strong>: {message.content}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
