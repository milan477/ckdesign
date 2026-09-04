"""
Merge pipeline for CK board collaboration.

Steps:
  1. detect           — LLM compares both boards' knowledge spaces, finds conflicts
  2. conflict_review  — user resolves each knowledge conflict
  3. restructuring    — LLM rebuilds knowledge space with resolved content
  4. concept_review   — LLM re-validates concepts + detects concept clashes
  5. done             — final merged CK state assembled
"""

import json
import logging
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.app.core.collaboration import get_session_members, require_session_member
from backend.app.core.security import get_current_user
from backend.app.db.supabase_client import get_supabase
from backend.app.services.ai.ai import OpenAIClient
from backend.app.services.nodes_generation.prompt_engine import CKPromptEngine

log = logging.getLogger(__name__)
router = APIRouter(prefix="/merge", tags=["merge"])

_ai: OpenAIClient | None = None


# ─── LLM helpers ─────────────────────────────────────────────────────────────

def _llm(prompt: str, system: str = "You are a CK (Concept-Knowledge) design assistant.") -> str:
    global _ai
    if _ai is None:
        _ai = OpenAIClient()
    response = _ai.client.chat.completions.create(
        model=_ai.llm_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        temperature=0,
    )
    return response.choices[0].message.content or ""


def _json_llm(prompt: str, system: str) -> Any:
    raw = _llm(prompt, system)
    clean = raw.strip()
    if clean.startswith("```"):
        clean = "\n".join(clean.split("\n")[1:])
    if clean.endswith("```"):
        clean = clean[: clean.rfind("```")]
    return json.loads(clean.strip())


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _extract_nodes(board: dict, node_type: str) -> list[dict]:
    ck = board.get("ck_nodes") or {}
    nodes = ck.get("nodes", []) if isinstance(ck, dict) else []
    return [n for n in nodes if n.get("type") == node_type]


def _node_summary(nodes: list[dict], owner: str) -> list[dict]:
    """Slim representation sent to the LLM — id, title, desc, owner."""
    return [
        {"id": n["id"], "title": n["title"], "desc": n.get("desc", ""), "owner": owner}
        for n in nodes
    ]


def _conflict_node_payload(nodes: list[dict], owner: str) -> dict:
    """Create a UI-safe conflict side while retaining its source node IDs."""
    if len(nodes) == 1:
        return {**nodes[0], "owner": owner}
    return {
        "id": "+".join(str(node["id"]) for node in nodes),
        "title": " + ".join(str(node.get("title", node["id"])) for node in nodes),
        "desc": "\n".join(str(node.get("desc", "")) for node in nodes if node.get("desc")),
        "owner": owner,
        "nodes": nodes,
    }


def _conflict_node_ids(payload: dict) -> list[str]:
    nodes = payload.get("nodes")
    if isinstance(nodes, list):
        return [str(node["id"]) for node in nodes if isinstance(node, dict) and node.get("id")]
    return [str(payload["id"])] if payload.get("id") else []


def _get_member_name(db: Any, session_id: str, user_id: str) -> str:
    row = (
        db.table("users")
        .select("username")
        .eq("id", user_id)
        .execute()
    )
    return row.data[0]["username"] if row.data else user_id[:8]


def _next_available_node_id(node_type: str, used_ids: set[str]) -> str:
    prefix = "C" if node_type == "concept" else "K"
    index = 0
    while f"{prefix}{index}" in used_ids:
        index += 1
    return f"{prefix}{index}"


def _normalise_board_node_ids(board: dict, used_ids: set[str], primary: bool) -> dict:
    """Return a copy whose node/element IDs cannot collide with another board."""
    normalised = deepcopy(board)
    ck_state = normalised.get("ck_nodes")
    if not isinstance(ck_state, dict):
        return normalised

    source_nodes = ck_state.get("nodes", [])
    if not isinstance(source_nodes, list):
        return normalised

    duplicate_root = not primary and "C0" in used_ids
    id_map: dict[str, str] = {}
    for node in source_nodes:
        old_id = str(node.get("id", ""))
        if not old_id:
            continue
        if duplicate_root and old_id == "C0":
            id_map[old_id] = "C0"
            continue
        new_id = old_id
        if new_id in used_ids:
            new_id = _next_available_node_id(str(node.get("type", "knowledge")), used_ids)
        id_map[old_id] = new_id
        used_ids.add(new_id)

    owner_tag = str(normalised.get("user_id", "board")).replace("-", "")[:8]
    nodes: list[dict] = []
    for source in source_nodes:
        old_id = str(source.get("id", ""))
        if not old_id:
            continue
        if duplicate_root and old_id == "C0":
            continue

        node = deepcopy(source)
        node["id"] = id_map[old_id]
        source_parents = node.get("sourceParentIds") or (
            [node["parentId"]] if node.get("parentId") else []
        )
        remapped_parents = [id_map.get(str(parent_id), str(parent_id)) for parent_id in source_parents]
        node["sourceParentIds"] = list(dict.fromkeys(remapped_parents))
        node["parentId"] = node["sourceParentIds"][0] if node["sourceParentIds"] else None
        node["elementId"] = f"merge-{owner_tag}-{node['id']}-node"
        arrow_ids = [
            f"merge-{owner_tag}-{node['id']}-arrow-{index}"
            for index in range(len(node["sourceParentIds"]))
        ]
        node["arrowId"] = arrow_ids[0] if arrow_ids else None
        node["extraArrowIds"] = arrow_ids[1:]
        nodes.append(node)

    normalised["ck_nodes"] = {**ck_state, "nodes": nodes}
    return normalised


def _load_boards_with_owners(db: Any, session_id: str) -> list[dict]:
    """
    Load both boards for a session, annotating each with the owner's username
    pulled from session_members + users tables.
    """
    members = get_session_members(db, session_id)
    if len(members) != 2:
        raise HTTPException(400, "A merge requires exactly 2 collaborators.")

    boards = (
        db.table("boards")
        .select("*")
        .eq("session_id", session_id)
        .execute()
    )
    board_by_user = {board["user_id"]: board for board in boards.data}
    if any(member["user_id"] not in board_by_user for member in members):
        raise HTTPException(400, "Need at least 2 boards to merge.")

    result: list[dict] = []
    used_ids: set[str] = set()
    for index, member in enumerate(members):
        b = _normalise_board_node_ids(
            board_by_user[member["user_id"]],
            used_ids,
            primary=index == 0,
        )
        b["owner_name"] = _get_member_name(db, session_id, b["user_id"])
        result.append(b)
    return result


def _require_merge_access(db: Any, merge_id: str, user_id: str) -> dict:
    result = db.table("merges").select("*").eq("id", merge_id).execute()
    if not result.data:
        raise HTTPException(404, "Merge not found.")
    merge = result.data[0]
    require_session_member(db, merge["session_id"], user_id)
    return merge


def _validate_resolutions(conflicts: list[dict], resolutions: list[Any]) -> None:
    expected_ids = {conflict["id"] for conflict in conflicts}
    provided_ids = {resolution.conflict_id for resolution in resolutions}
    if provided_ids != expected_ids:
        raise HTTPException(400, "Provide exactly one resolution for every conflict in this step.")
    for resolution in resolutions:
        if resolution.choice not in {"a", "b", "custom"}:
            raise HTTPException(400, "Conflict choice must be a, b, or custom.")
        if resolution.choice == "custom" and not (resolution.custom_text or "").strip():
            raise HTTPException(400, "Custom resolutions require text.")


def _deconflict_node_positions(nodes: list[dict]) -> list[dict]:
    """Keep the two source layouts while preventing merged cards from overlapping."""
    result = deepcopy(nodes)
    for node_type in ("concept", "knowledge"):
        typed = [node for node in result if node.get("type") == node_type]
        typed.sort(
            key=lambda node: (
                0 if node.get("id") == "C0" else 1,
                float(node.get("y") or 0),
                int(node.get("sequence") or 0),
                str(node.get("id", "")),
            )
        )
        next_y: float | None = None
        for node in typed:
            y = float(node.get("y") or 0)
            height = float(node.get("height") or 140)
            if next_y is not None:
                y = max(y, next_y)
            node["y"] = y
            next_y = y + height + 60

    existing_ids = {str(node.get("id")) for node in result}
    for sequence, node in enumerate(result, start=1):
        parents = node.get("sourceParentIds") or (
            [node["parentId"]] if node.get("parentId") else []
        )
        parents = [parent for parent in parents if parent in existing_ids]
        node["sourceParentIds"] = list(dict.fromkeys(parents))
        node["parentId"] = node["sourceParentIds"][0] if node["sourceParentIds"] else None
        node["sequence"] = sequence
        node.pop("owner", None)
    return result


# ─── Schemas ─────────────────────────────────────────────────────────────────

class MergeStatusResponse(BaseModel):
    ready: bool
    reason: str
    merge_id: str | None = None
    status: str | None = None


class StartMergeRequest(BaseModel):
    session_id: str


class ConflictResolution(BaseModel):
    conflict_id: str
    choice: str          # "a" | "b" | "custom"
    custom_text: str | None = None


class ResolveConflictsRequest(BaseModel):
    merge_id: str
    resolutions: list[ConflictResolution]


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.get("/status/{session_id}", response_model=MergeStatusResponse)
async def merge_status(session_id: str, user: dict = Depends(get_current_user)):
    """
    Check whether both collaborators have pushed since the last merge (or ever).
    Returns ready=True when a new merge can be started.
    """
    db = get_supabase()
    require_session_member(db, session_id, user["sub"])

    members = get_session_members(db, session_id)
    if len(members) < 2:
        return MergeStatusResponse(ready=False, reason="Waiting for a second collaborator to join.")
    if len(members) > 2:
        return MergeStatusResponse(ready=False, reason="This session has more than two collaborators and cannot be merged safely.")

    boards = (
        db.table("boards")
        .select("user_id, pushed_at")
        .eq("session_id", session_id)
        .execute()
    )
    board_by_user = {board["user_id"]: board for board in boards.data}
    pushed = [
        board_by_user[member["user_id"]]
        for member in members
        if member["user_id"] in board_by_user and board_by_user[member["user_id"]]["pushed_at"]
    ]
    if len(pushed) != 2:
        return MergeStatusResponse(ready=False, reason="Both collaborators must push before merging.")

    existing = db.table("merges").select("*").eq("session_id", session_id).execute()
    if existing.data:
        merge = existing.data[0]
        if merge["status"] not in ("done",):
            return MergeStatusResponse(
                ready=True,
                reason="A merge is already in progress.",
                merge_id=merge["id"],
                status=merge["status"],
            )
        merged_at = merge["completed_at"]
        if merged_at and all(b["pushed_at"] <= merged_at for b in pushed):
            return MergeStatusResponse(ready=False, reason="No new pushes since the last merge.")

    return MergeStatusResponse(ready=True, reason="Ready to merge.")


@router.post("/start")
async def start_merge(req: StartMergeRequest, user: dict = Depends(get_current_user)):
    """
    Step 1: LLM detects knowledge conflicts between the two pushed boards.
    Creates / resets the merge record and populates merge_conflicts for knowledge clashes.
    """
    db = get_supabase()
    require_session_member(db, req.session_id, user["sub"])

    boards = _load_boards_with_owners(db, req.session_id)
    if any(not board.get("pushed_at") for board in boards):
        raise HTTPException(400, "Both collaborators must push before merging.")
    board_a, board_b = boards[0], boards[1]
    owner_a, owner_b = board_a["owner_name"], board_b["owner_name"]

    # Starting is idempotent while a review is active. This prevents a double
    # click or retry from deleting resolutions that collaborators already made.
    existing = db.table("merges").select("*").eq("session_id", req.session_id).execute()
    if existing.data and existing.data[0]["status"] != "done":
        current = existing.data[0]
        conflicts = (
            db.table("merge_conflicts")
            .select("*")
            .eq("merge_id", current["id"])
            .execute()
        )
        return {**current, "merge_id": current["id"], "conflicts": conflicts.data}

    if existing.data and existing.data[0].get("completed_at"):
        completed_at = existing.data[0]["completed_at"]
        if all(board["pushed_at"] <= completed_at for board in boards):
            raise HTTPException(409, "Both collaborators must push new changes before merging again.")

    knowledge_a = _extract_nodes(board_a, "knowledge")
    knowledge_b = _extract_nodes(board_b, "knowledge")

    # Create or reset the merge record
    if existing.data:
        merge_id = existing.data[0]["id"]
        db.table("merges").update({
            "initiator_id": user["sub"],
            "status": "detecting",
            "merged_ck_state": None,
            "completed_at": None,
        }).eq("id", merge_id).execute()
        db.table("merge_conflicts").delete().eq("merge_id", merge_id).execute()
    else:
        result = db.table("merges").insert({
            "session_id": req.session_id,
            "initiator_id": user["sub"],
            "status": "detecting",
        }).execute()
        merge_id = result.data[0]["id"]

    # ── LLM knowledge conflict detection ────────────────────────────────────
    prompt = CKPromptEngine.detect_knowledge_conflicts(
        topic=_get_session_topic(db, req.session_id),
        knowledge_a_json=json.dumps(_node_summary(knowledge_a, owner_a), indent=2),
        knowledge_b_json=json.dumps(_node_summary(knowledge_b, owner_b), indent=2),
        owner_a=owner_a,
        owner_b=owner_b,
    )

    try:
        conflicts_raw = _json_llm(
            prompt,
            "You are a C-K Theory merge expert. Detect semantic conflicts in knowledge spaces. "
            "Respond only with a valid JSON array.",
        )
    except Exception as e:
        log.error("LLM knowledge conflict detection failed: %s", e)
        conflicts_raw = []
    if not isinstance(conflicts_raw, list):
        log.error("LLM knowledge conflict detection returned a non-list payload")
        conflicts_raw = []

    node_a_by_id = {n["id"]: n for n in knowledge_a}
    node_b_by_id = {n["id"]: n for n in knowledge_b}

    conflict_rows = []
    for c in conflicts_raw:
        ids_a = c.get("ids_a", [])
        ids_b = c.get("ids_b", [])
        # Resolve to actual node objects; skip if any ID is missing
        nodes_a = [node_a_by_id[i] for i in ids_a if i in node_a_by_id]
        nodes_b = [node_b_by_id[i] for i in ids_b if i in node_b_by_id]
        if not nodes_a or not nodes_b:
            continue

        # For pairwise conflicts store the single nodes; for combinations store lists
        conflict_rows.append({
            "merge_id": merge_id,
            "conflict_type": "knowledge",
            "step": 1,
            "node_a": _conflict_node_payload(nodes_a, owner_a),
            "node_b": _conflict_node_payload(nodes_b, owner_b),
            "explanation": f"[{c.get('type', 'CONFLICT')}] {c.get('explanation', '')}",
        })

    if conflict_rows:
        db.table("merge_conflicts").insert(conflict_rows).execute()

    db.table("merges").update({"status": "conflict_review"}).eq("id", merge_id).execute()

    conflicts_out = db.table("merge_conflicts").select("*").eq("merge_id", merge_id).execute()
    return {
        "id": merge_id,
        "merge_id": merge_id,
        "session_id": req.session_id,
        "status": "conflict_review",
        "merged_ck_state": None,
        "conflicts": conflicts_out.data,
    }


@router.post("/resolve-knowledge")
async def resolve_knowledge(req: ResolveConflictsRequest, user: dict = Depends(get_current_user)):
    """
    Steps 2–4: Persist user resolutions for knowledge conflicts, LLM restructures
    the merged K-space, then LLM re-validates concepts and detects concept clashes.
    """
    db = get_supabase()

    merge_record = _require_merge_access(db, req.merge_id, user["sub"])
    if merge_record["status"] != "conflict_review":
        raise HTTPException(409, "This merge is not awaiting knowledge resolutions.")
    session_id = merge_record["session_id"]
    topic = _get_session_topic(db, session_id)

    conflicts_data = (
        db.table("merge_conflicts")
        .select("*")
        .eq("merge_id", req.merge_id)
        .eq("step", 1)
        .execute()
    )
    _validate_resolutions(conflicts_data.data, req.resolutions)

    # Persist resolutions
    now = datetime.now(timezone.utc).isoformat()
    for res in req.resolutions:
        db.table("merge_conflicts").update({
            "resolution": {"choice": res.choice, "custom_text": res.custom_text},
            "resolved_at": now,
        }).eq("merge_id", req.merge_id).eq("id", res.conflict_id).eq("step", 1).execute()

    boards = _load_boards_with_owners(db, session_id)
    board_a, board_b = boards[0], boards[1]
    owner_a, owner_b = board_a["owner_name"], board_b["owner_name"]

    knowledge_a = _extract_nodes(board_a, "knowledge")
    knowledge_b = _extract_nodes(board_b, "knowledge")

    # Build the combined list. IDs were normalised when the boards were loaded,
    # so independently generated C1/K0 nodes remain separate here.
    all_k_by_id: dict[str, dict] = {}
    for n in knowledge_a:
        all_k_by_id[n["id"]] = {**n, "owner": owner_a}
    for n in knowledge_b:
        if n["id"] not in all_k_by_id:
            all_k_by_id[n["id"]] = {**n, "owner": owner_b}
    all_k = list(all_k_by_id.values())

    # Summarise resolutions for the LLM
    conflicts_data = (
        db.table("merge_conflicts")
        .select("*")
        .eq("merge_id", req.merge_id)
        .eq("step", 1)
        .execute()
    )
    resolved_notes = []
    discarded_ids: set[str] = set()
    custom_text_by_id: dict[str, str] = {}
    for c in conflicts_data.data:
        res = c["resolution"] or {}
        choice = res.get("choice", "a")
        winner = c["node_b"] if choice == "b" else c["node_a"]
        loser = c["node_a"] if choice == "b" else c["node_b"]
        discarded_ids.update(_conflict_node_ids(loser))
        custom_text = (res.get("custom_text") or "").strip()
        if choice == "custom" and custom_text:
            winner_ids = _conflict_node_ids(winner)
            if winner_ids:
                custom_text_by_id[winner_ids[0]] = custom_text
        resolved_notes.append({
            "winner_id": winner.get("id") or winner,
            "loser_id":  loser.get("id") or loser,
            "custom_text": custom_text or None,
            "explanation": c["explanation"],
        })

    all_k = [
        {**node, **({"desc": custom_text_by_id[node["id"]]} if node["id"] in custom_text_by_id else {})}
        for node in all_k
        if node["id"] not in discarded_ids
    ]

    # ── LLM restructure ─────────────────────────────────────────────────────
    restructure_prompt = CKPromptEngine.restructure_merged_knowledge(
        topic=topic,
        all_knowledge_json=json.dumps(
            [{"id": n["id"], "title": n["title"], "desc": n.get("desc", ""), "owner": n["owner"]} for n in all_k],
            indent=2,
        ),
        resolved_conflicts_json=json.dumps(resolved_notes, indent=2),
    )
    try:
        restructured = _json_llm(
            restructure_prompt,
            "You are a C-K Theory structural expert. Restructure merged knowledge spaces. "
            "Respond only with valid JSON.",
        )
        if not isinstance(restructured, dict):
            raise ValueError("Knowledge restructure response must be an object")
        merged_entries = restructured.get("knowledge_entries", all_k)
        if not isinstance(merged_entries, list):
            merged_entries = all_k
        source_by_id = {node["id"]: node for node in all_k}
        merged_knowledge = []
        materialized_ids: set[str] = set()
        for entry in merged_entries:
            if not isinstance(entry, dict):
                continue
            source = source_by_id.get(entry.get("id"))
            if source:
                merged_knowledge.append({
                    **source,
                    "title": entry.get("title", source["title"]),
                    "desc": entry.get("desc", source.get("desc", "")),
                })
                materialized_ids.add(source["id"])
        # The model may accidentally omit entries. Preserve every source node;
        # conflict choices are applied separately and must be the only deletions.
        merged_knowledge.extend(
            node for node in all_k if node["id"] not in materialized_ids
        )
        change_report = restructured.get("change_report", "")
    except Exception as e:
        log.error("Knowledge restructure failed: %s", e)
        merged_knowledge = all_k
        change_report = ""

    db.table("merges").update({
        "status": "restructuring",
        "merged_ck_state": {"merged_knowledge": merged_knowledge, "change_report": change_report},
    }).eq("id", req.merge_id).execute()

    # ── LLM concept recheck ──────────────────────────────────────────────────
    concepts_a = _extract_nodes(board_a, "concept")
    concepts_b = _extract_nodes(board_b, "concept")

    recheck_prompt = CKPromptEngine.revalidate_concepts_after_merge(
        topic=topic,
        merged_knowledge_json=json.dumps(
            [{"id": n["id"], "title": n["title"], "desc": n.get("desc", "")} for n in merged_knowledge],
            indent=2,
        ),
        concepts_a_json=json.dumps(_node_summary(concepts_a, owner_a), indent=2),
        concepts_b_json=json.dumps(_node_summary(concepts_b, owner_b), indent=2),
        owner_a=owner_a,
        owner_b=owner_b,
    )
    try:
        recheck = _json_llm(
            recheck_prompt,
            "You are a C-K Theory validation expert. Respond only with valid JSON.",
        )
    except Exception as e:
        log.error("Concept recheck failed: %s", e)
        recheck = {"revalidated": [], "concept_conflicts": []}
    if not isinstance(recheck, dict):
        log.error("Concept recheck returned a non-object payload")
        recheck = {"revalidated": [], "concept_conflicts": []}

    # Store concept conflicts
    concepts_a_by_id = {n["id"]: n for n in concepts_a}
    concepts_b_by_id = {n["id"]: n for n in concepts_b}

    concept_conflict_rows = []
    for cc in recheck.get("concept_conflicts", []):
        ca = concepts_a_by_id.get(cc.get("concept_a_id"))
        cb = concepts_b_by_id.get(cc.get("concept_b_id"))
        if ca and cb:
            concept_conflict_rows.append({
                "merge_id": req.merge_id,
                "conflict_type": "concept",
                "step": 2,
                "node_a": {**ca, "owner": cc.get("owner_a", owner_a)},
                "node_b": {**cb, "owner": cc.get("owner_b", owner_b)},
                "explanation": cc.get("explanation", ""),
            })

    if concept_conflict_rows:
        db.table("merge_conflicts").insert(concept_conflict_rows).execute()

    db.table("merges").update({
        "status": "concept_review",
        "merged_ck_state": {
            "merged_knowledge": merged_knowledge,
            "change_report": change_report,
            "revalidated": recheck.get("revalidated", []),
        },
    }).eq("id", req.merge_id).execute()

    new_conflicts = (
        db.table("merge_conflicts")
        .select("*")
        .eq("merge_id", req.merge_id)
        .eq("step", 2)
        .execute()
    )
    return {
        "id": req.merge_id,
        "merge_id": req.merge_id,
        "session_id": session_id,
        "status": "concept_review",
        "merged_ck_state": {
            "merged_knowledge": merged_knowledge,
            "change_report": change_report,
            "revalidated": recheck.get("revalidated", []),
        },
        "conflicts": new_conflicts.data,
        "change_report": change_report,
        "revalidated": recheck.get("revalidated", []),
        "concept_conflicts": new_conflicts.data,
    }


@router.post("/resolve-concepts")
async def resolve_concepts(req: ResolveConflictsRequest, user: dict = Depends(get_current_user)):
    """
    Step 5: Accept concept conflict resolutions and assemble the final merged board.
    """
    db = get_supabase()

    merge_record = _require_merge_access(db, req.merge_id, user["sub"])
    if merge_record["status"] != "concept_review":
        raise HTTPException(409, "This merge is not awaiting concept resolutions.")
    session_id = merge_record["session_id"]
    partial_state = merge_record.get("merged_ck_state") or {}

    concept_conflicts = (
        db.table("merge_conflicts")
        .select("*")
        .eq("merge_id", req.merge_id)
        .eq("step", 2)
        .execute()
    )
    _validate_resolutions(concept_conflicts.data, req.resolutions)

    now = datetime.now(timezone.utc).isoformat()
    for res in req.resolutions:
        db.table("merge_conflicts").update({
            "resolution": {"choice": res.choice, "custom_text": res.custom_text},
            "resolved_at": now,
        }).eq("merge_id", req.merge_id).eq("id", res.conflict_id).eq("step", 2).execute()

    boards = _load_boards_with_owners(db, session_id)
    board_a, board_b = boards

    base_concepts: list[dict] = _extract_nodes(board_a, "concept") + _extract_nodes(board_b, "concept")
    merged_knowledge: list[dict] = partial_state.get("merged_knowledge", [])
    revalidated: list[dict] = partial_state.get("revalidated", [])
    revalidated_map = {r["id"]: r["validationStatus"] for r in revalidated}

    # Determine which concepts were discarded
    discarded_ids: set[str] = set()
    custom_concepts: dict[str, str] = {}
    for c in concept_conflicts.data:
        res = c["resolution"] or {}
        choice = res.get("choice", "a")
        loser = c["node_a"] if choice == "b" else c["node_b"]
        loser_id = loser.get("id") if isinstance(loser, dict) else None
        if loser_id:
            discarded_ids.add(loser_id)
        if choice == "custom" and isinstance(c["node_a"], dict):
            custom_concepts[c["node_a"].get("id", "")] = (res.get("custom_text") or "").strip()

    final_nodes: list[dict] = []
    seen: set[str] = set()
    for n in [*base_concepts, *merged_knowledge]:
        if n["id"] in discarded_ids or n["id"] in seen:
            continue
        seen.add(n["id"])
        if n["type"] == "concept" and n["id"] in revalidated_map:
            n = {**n, "validationStatus": revalidated_map[n["id"]]}
        if n["id"] in custom_concepts:
            n = {**n, "desc": custom_concepts[n["id"]]}
        final_nodes.append(n)

    final_nodes = _deconflict_node_positions(final_nodes)

    base_ck = (board_a.get("ck_nodes") or {}) if isinstance(board_a.get("ck_nodes"), dict) else {}
    final_ck_state = {
        **base_ck,
        "nodes": final_nodes,
        "change_report": partial_state.get("change_report", ""),
        "savedAt": now,
    }

    db.table("merges").update({
        "status": "done",
        "merged_ck_state": final_ck_state,
        "completed_at": now,
    }).eq("id", req.merge_id).execute()

    return {
        "id": req.merge_id,
        "merge_id": req.merge_id,
        "session_id": session_id,
        "status": "done",
        "merged_ck_state": final_ck_state,
        "conflicts": [],
    }


@router.get("/state/{merge_id}")
async def get_merge_state(merge_id: str, user: dict = Depends(get_current_user)):
    db = get_supabase()
    merge = _require_merge_access(db, merge_id, user["sub"])
    conflicts = db.table("merge_conflicts").select("*").eq("merge_id", merge_id).execute()
    return {**merge, "conflicts": conflicts.data}


# ─── Internal helpers ─────────────────────────────────────────────────────────

def _get_session_topic(db: Any, session_id: str) -> str:
    row = (
        db.table("collaboration_sessions")
        .select("initial_concept, requirements")
        .eq("id", session_id)
        .execute()
    )
    if not row.data:
        return "the design project"
    r = row.data[0]
    topic = r["initial_concept"]
    if r.get("requirements"):
        topic += f" (requirements: {r['requirements']})"
    return topic
