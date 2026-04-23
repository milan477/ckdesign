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
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.app.core.security import get_current_user
from backend.app.db.supabase_client import get_supabase
from backend.app.services.ai.ai import OpenAIClient
from backend.app.services.nodes_generation.prompt_engine import CKPromptEngine

log = logging.getLogger(__name__)
router = APIRouter(prefix="/merge", tags=["merge"])

_ai = OpenAIClient()


# ─── LLM helpers ─────────────────────────────────────────────────────────────

def _llm(prompt: str, system: str = "You are a CK (Concept-Knowledge) design assistant.") -> str:
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


def _get_member_name(db: Any, session_id: str, user_id: str) -> str:
    row = (
        db.table("users")
        .select("username")
        .eq("id", user_id)
        .execute()
    )
    return row.data[0]["username"] if row.data else user_id[:8]


def _load_boards_with_owners(db: Any, session_id: str) -> list[dict]:
    """
    Load both boards for a session, annotating each with the owner's username
    pulled from session_members + users tables.
    """
    boards = (
        db.table("boards")
        .select("*")
        .eq("session_id", session_id)
        .execute()
    )
    if len(boards.data) < 2:
        raise HTTPException(400, "Need at least 2 boards to merge.")

    result = []
    for b in boards.data[:2]:
        b["owner_name"] = _get_member_name(db, session_id, b["user_id"])
        result.append(b)
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

    members = db.table("session_members").select("user_id").eq("session_id", session_id).execute()
    if len(members.data) < 2:
        return MergeStatusResponse(ready=False, reason="Waiting for a second collaborator to join.")

    boards = (
        db.table("boards")
        .select("user_id, pushed_at")
        .eq("session_id", session_id)
        .execute()
    )
    pushed = [b for b in boards.data if b["pushed_at"]]
    if len(pushed) < 2:
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

    boards = _load_boards_with_owners(db, req.session_id)
    board_a, board_b = boards[0], boards[1]
    owner_a, owner_b = board_a["owner_name"], board_b["owner_name"]

    knowledge_a = _extract_nodes(board_a, "knowledge")
    knowledge_b = _extract_nodes(board_b, "knowledge")

    # Create or reset the merge record
    existing = db.table("merges").select("id").eq("session_id", req.session_id).execute()
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
            # node_a / node_b hold either a single node dict or a list for combinations
            "node_a": nodes_a[0] if len(nodes_a) == 1 else {"nodes": nodes_a, "owner": owner_a},
            "node_b": nodes_b[0] if len(nodes_b) == 1 else {"nodes": nodes_b, "owner": owner_b},
            "explanation": f"[{c.get('type', 'CONFLICT')}] {c.get('explanation', '')}",
        })

    if conflict_rows:
        db.table("merge_conflicts").insert(conflict_rows).execute()

    db.table("merges").update({"status": "conflict_review"}).eq("id", merge_id).execute()

    conflicts_out = db.table("merge_conflicts").select("*").eq("merge_id", merge_id).execute()
    return {"merge_id": merge_id, "status": "conflict_review", "conflicts": conflicts_out.data}


@router.post("/resolve-knowledge")
async def resolve_knowledge(req: ResolveConflictsRequest, user: dict = Depends(get_current_user)):
    """
    Steps 2–4: Persist user resolutions for knowledge conflicts, LLM restructures
    the merged K-space, then LLM re-validates concepts and detects concept clashes.
    """
    db = get_supabase()

    merge = db.table("merges").select("*").eq("id", req.merge_id).execute()
    if not merge.data:
        raise HTTPException(404, "Merge not found.")
    merge_record = merge.data[0]
    session_id = merge_record["session_id"]
    topic = _get_session_topic(db, session_id)

    # Persist resolutions
    now = datetime.now(timezone.utc).isoformat()
    for res in req.resolutions:
        db.table("merge_conflicts").update({
            "resolution": {"choice": res.choice, "custom_text": res.custom_text},
            "resolved_at": now,
        }).eq("id", res.conflict_id).execute()

    boards = _load_boards_with_owners(db, session_id)
    board_a, board_b = boards[0], boards[1]
    owner_a, owner_b = board_a["owner_name"], board_b["owner_name"]

    knowledge_a = _extract_nodes(board_a, "knowledge")
    knowledge_b = _extract_nodes(board_b, "knowledge")

    # Build the combined list (deduplicated by id, B supplements A)
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
    for c in conflicts_data.data:
        res = c["resolution"] or {}
        choice = res.get("choice", "a")
        winner = c["node_a"] if choice == "a" else c["node_b"]
        loser  = c["node_b"] if choice == "a" else c["node_a"]
        resolved_notes.append({
            "winner_id": winner.get("id") or winner,
            "loser_id":  loser.get("id") or loser,
            "custom_text": res.get("custom_text"),
            "explanation": c["explanation"],
        })

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
        merged_knowledge = restructured.get("knowledge_entries", all_k)
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
        "merge_id": req.merge_id,
        "status": "concept_review",
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

    merge = db.table("merges").select("*").eq("id", req.merge_id).execute()
    if not merge.data:
        raise HTTPException(404, "Merge not found.")
    merge_record = merge.data[0]
    session_id = merge_record["session_id"]
    partial_state = merge_record.get("merged_ck_state") or {}

    now = datetime.now(timezone.utc).isoformat()
    for res in req.resolutions:
        db.table("merge_conflicts").update({
            "resolution": {"choice": res.choice, "custom_text": res.custom_text},
            "resolved_at": now,
        }).eq("id", res.conflict_id).execute()

    boards = _load_boards_with_owners(db, session_id)
    board_a = boards[0]

    base_nodes: list[dict] = _extract_nodes(board_a, "concept") + _extract_nodes(board_a, "knowledge")
    merged_knowledge: list[dict] = partial_state.get("merged_knowledge", [])
    revalidated: list[dict] = partial_state.get("revalidated", [])
    revalidated_map = {r["id"]: r["validationStatus"] for r in revalidated}

    # Determine which concepts were discarded
    concept_conflicts = (
        db.table("merge_conflicts")
        .select("*")
        .eq("merge_id", req.merge_id)
        .eq("step", 2)
        .execute()
    )
    discarded_ids: set[str] = set()
    for c in concept_conflicts.data:
        res = c["resolution"] or {}
        choice = res.get("choice", "a")
        loser = c["node_b"] if choice == "a" else c["node_a"]
        loser_id = loser.get("id") if isinstance(loser, dict) else None
        if loser_id:
            discarded_ids.add(loser_id)

    merged_k_by_id = {n["id"]: n for n in merged_knowledge}

    final_nodes: list[dict] = []
    seen: set[str] = set()
    for n in base_nodes:
        if n["id"] in discarded_ids or n["id"] in seen:
            continue
        seen.add(n["id"])
        if n["type"] == "concept" and n["id"] in revalidated_map:
            n = {**n, "validationStatus": revalidated_map[n["id"]]}
        if n["type"] == "knowledge":
            mk = merged_k_by_id.get(n["id"])
            if mk:
                n = {**n, "title": mk["title"], "desc": mk.get("desc", n.get("desc", ""))}
            else:
                continue  # discarded by knowledge restructure
        final_nodes.append(n)

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

    return {"merge_id": req.merge_id, "status": "done", "merged_ck_state": final_ck_state}


@router.get("/state/{merge_id}")
async def get_merge_state(merge_id: str, user: dict = Depends(get_current_user)):
    db = get_supabase()
    merge = db.table("merges").select("*").eq("id", merge_id).execute()
    if not merge.data:
        raise HTTPException(404, "Merge not found.")
    conflicts = db.table("merge_conflicts").select("*").eq("merge_id", merge_id).execute()
    return {**merge.data[0], "conflicts": conflicts.data}


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
