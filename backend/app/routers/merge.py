"""
Merge pipeline for CK board collaboration.

Workflow:
  1. detect conflicts across both collaborators' pushed CK boards
  2. let the user resolve grouped conflicts in the UI
  3. assemble a merged semantic CK board from those resolutions
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel

from backend.app.core.security import get_current_user
from backend.app.db.supabase_client import get_supabase
from backend.app.services.ai.ai import OpenAIClient
from backend.app.services.nodes_generation.prompt_engine import CKPromptEngine

log = logging.getLogger(__name__)
router = APIRouter(prefix="/merge", tags=["merge"])

_ai = OpenAIClient()

MERGE_CONFLICT_TYPES = {
    "duplicate_concept",
    "duplicate_knowledge",
    "concept_rejected_by_knowledge",
    "contradicting_concept",
}


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

def _extract_nodes(board: dict) -> list[dict]:
    ck = board.get("ck_nodes") or {}
    nodes = ck.get("nodes", []) if isinstance(ck, dict) else []
    return [n for n in nodes if isinstance(n, dict)]


def _get_member_name(db: Any, user_id: str) -> str:
    row = db.table("users").select("username").eq("id", user_id).execute()
    return row.data[0]["username"] if row.data else user_id[:8]


def _load_boards_with_owners(db: Any, session_id: str) -> list[dict]:
    boards = db.table("boards").select("*").eq("session_id", session_id).execute()
    if len(boards.data) < 2:
        raise HTTPException(400, "Need at least 2 boards to merge.")

    result = []
    for board in sorted(boards.data, key=lambda item: str(item.get("user_id", "")))[:2]:
        result.append(
            {
                **board,
                "owner_name": _get_member_name(db, board["user_id"]),
            }
        )
    return result


def _merge_ref(side: str, node_id: str) -> str:
    return f"{side}:{node_id}"


def _coerce_parent_id(node: dict) -> str | None:
    value = node.get("parentId", node.get("parent_id"))
    if value in ("", None):
        return None
    return str(value)


def _coerce_source_parent_ids(node: dict) -> list[str]:
    value = node.get("sourceParentIds", node.get("source_parent_ids", []))
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if item not in ("", None)]


def _normalize_board_nodes(board: dict, side: str) -> list[dict]:
    owner = board["owner_name"]
    normalized: list[dict] = []

    for index, raw in enumerate(_extract_nodes(board)):
        original_id = str(raw.get("id", ""))
        if not original_id or raw.get("type") not in ("concept", "knowledge"):
            continue

        parent_id = _coerce_parent_id(raw)
        source_parent_ids = _coerce_source_parent_ids(raw)
        normalized.append(
            {
                "merge_ref": _merge_ref(side, original_id),
                "original_id": original_id,
                "display_id": original_id,
                "side": side,
                "owner": owner,
                "type": raw["type"],
                "title": str(raw.get("title", "")).strip(),
                "desc": str(raw.get("desc", "")).strip(),
                "operation_rationale": str(
                    raw.get("operationRationale", raw.get("operation_rationale", ""))
                ).strip(),
                "parent_ref": _merge_ref(side, parent_id) if parent_id else None,
                "source_parent_refs": [_merge_ref(side, ref) for ref in source_parent_ids],
                "validationStatus": raw.get("validationStatus", raw.get("validation_status")),
                "sequence": int(raw.get("sequence", index)),
                "createdAt": raw.get("createdAt", raw.get("created_at")),
                "is_root": raw["type"] == "concept" and original_id == "C0",
            }
        )

    return normalized


def _llm_node_summary(nodes: list[dict]) -> list[dict]:
    return [
        {
            "id": node["merge_ref"],
            "display_id": node["display_id"],
            "owner": node["owner"],
            "type": node["type"],
            "title": node["title"],
            "desc": node["desc"],
            **(
                {"validation_status": node["validationStatus"]}
                if node.get("validationStatus")
                else {}
            ),
        }
        for node in nodes
    ]


def _build_conflict_payload(node: dict) -> dict:
    return {
        "merge_ref": node["merge_ref"],
        "original_id": node["original_id"],
        "id": node["display_id"],
        "owner": node["owner"],
        "type": node["type"],
        "title": node["title"],
        "desc": node["desc"],
        "operation_rationale": node.get("operation_rationale", ""),
        "parent_ref": node.get("parent_ref"),
        "source_parent_refs": node.get("source_parent_refs", []),
        "validationStatus": node.get("validationStatus"),
        "sequence": node.get("sequence", 0),
        "is_root": node.get("is_root", False),
    }


def _serialize_conflict(row: dict) -> dict:
    resolution = row.get("resolution") or {}
    suggested_resolution = None
    if any(
        resolution.get(key)
        for key in ("suggested_choice", "suggested_title", "suggested_desc", "suggested_rationale")
    ):
        suggested_resolution = {
            "choice": resolution.get("suggested_choice"),
            "title": resolution.get("suggested_title"),
            "desc": resolution.get("suggested_desc"),
            "rationale": resolution.get("suggested_rationale"),
        }

    final_resolution = None
    if resolution.get("choice"):
        final_resolution = {
            "choice": resolution.get("choice"),
            "custom_title": resolution.get("custom_title"),
            "custom_desc": resolution.get("custom_desc"),
        }

    return {
        **row,
        "suggested_resolution": suggested_resolution,
        "resolution": final_resolution,
    }


def _serialize_conflicts(rows: list[dict]) -> list[dict]:
    return [_serialize_conflict(row) for row in rows]


def _is_same_shared_root(node_a: dict, node_b: dict) -> bool:
    return (
        node_a.get("is_root")
        and node_b.get("is_root")
        and node_a.get("type") == "concept"
        and node_b.get("type") == "concept"
        and node_a.get("title", "").strip().lower() == node_b.get("title", "").strip().lower()
    )


def _pick_root_concept(nodes_a: list[dict], nodes_b: list[dict]) -> dict | None:
    root_a = next((node for node in nodes_a if node.get("is_root")), None)
    root_b = next((node for node in nodes_b if node.get("is_root")), None)
    return root_a or root_b


def _dedupe_source_refs(source_refs: list[str], ref_to_node: dict[str, dict], self_ref: str | None = None) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for ref in source_refs:
        if not ref or ref == self_ref or ref not in ref_to_node or ref in seen:
            continue
        seen.add(ref)
        ordered.append(ref)
    return ordered


def _make_custom_node(
    conflict: dict,
    resolution: dict,
    ref_to_node: dict[str, dict],
    root_ref: str | None,
) -> dict:
    node_a = conflict["node_a"]
    node_b = conflict["node_b"]
    conflict_type = conflict["conflict_type"]

    custom_type = "knowledge" if conflict_type == "duplicate_knowledge" else "concept"
    title = (resolution.get("custom_title") or "").strip()
    desc = (resolution.get("custom_desc") or "").strip()
    if not title:
        raise HTTPException(400, f"Conflict {conflict['id']} needs a custom title.")

    concept_node = None
    knowledge_node = None
    if node_a.get("type") == "concept":
        concept_node = node_a
    if node_b.get("type") == "concept":
        concept_node = node_b if concept_node is None else concept_node
    if node_a.get("type") == "knowledge":
        knowledge_node = node_a
    if node_b.get("type") == "knowledge":
        knowledge_node = node_b if knowledge_node is None else knowledge_node

    source_refs: list[str] = []
    if conflict_type == "concept_rejected_by_knowledge":
        if concept_node:
            source_refs.extend(
                [concept_node.get("parent_ref")] + concept_node.get("source_parent_refs", [])
            )
        if knowledge_node:
            source_refs.append(knowledge_node["merge_ref"])
            source_refs.extend(knowledge_node.get("source_parent_refs", []))
    else:
        for node in (node_a, node_b):
            source_refs.append(node.get("parent_ref"))
            source_refs.extend(node.get("source_parent_refs", []))

    source_refs = _dedupe_source_refs(source_refs, ref_to_node)
    parent_ref = next(
        (
            ref
            for ref in source_refs
            if ref_to_node.get(ref, {}).get("type") == "concept"
        ),
        None,
    )
    if custom_type == "concept" and not parent_ref and root_ref:
        parent_ref = root_ref
        if root_ref not in source_refs:
            source_refs.insert(0, root_ref)

    return {
        "merge_ref": f"merged:{conflict['id']}",
        "original_id": f"M-{conflict['id'][:6]}",
        "display_id": "Merged",
        "side": "merged",
        "owner": "Merged",
        "type": custom_type,
        "title": title,
        "desc": desc,
        "operation_rationale": (
            f"Created during merge resolution for {conflict_type.replace('_', ' ')}."
        ),
        "parent_ref": parent_ref,
        "source_parent_refs": source_refs,
        "validationStatus": "undecided" if custom_type == "concept" else None,
        "sequence": 10_000,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "is_root": False,
    }


def _assemble_merged_entries(
    conflicts: list[dict],
    board_a: dict,
    board_b: dict,
) -> dict:
    nodes_a = _normalize_board_nodes(board_a, "a")
    nodes_b = _normalize_board_nodes(board_b, "b")
    root = _pick_root_concept(nodes_a, nodes_b)
    root_ref = root["merge_ref"] if root else None

    active_nodes: dict[str, dict] = {}
    for node in nodes_a:
        active_nodes[node["merge_ref"]] = node
    for node in nodes_b:
        if root and _is_same_shared_root(root, node):
            continue
        active_nodes[node["merge_ref"]] = node

    for conflict in conflicts:
        resolution = conflict.get("resolution") or {}
        choice = resolution.get("choice")
        if not choice:
            raise HTTPException(400, "Every conflict must be resolved before finalizing the merge.")

        node_a = conflict["node_a"]
        node_b = conflict["node_b"]

        if choice == "a":
            active_nodes.pop(node_b["merge_ref"], None)
            active_nodes[node_a["merge_ref"]] = active_nodes.get(node_a["merge_ref"], node_a)
        elif choice == "b":
            active_nodes.pop(node_a["merge_ref"], None)
            active_nodes[node_b["merge_ref"]] = active_nodes.get(node_b["merge_ref"], node_b)
        elif choice == "both":
            active_nodes[node_a["merge_ref"]] = active_nodes.get(node_a["merge_ref"], node_a)
            active_nodes[node_b["merge_ref"]] = active_nodes.get(node_b["merge_ref"], node_b)
        elif choice == "custom":
            if conflict["conflict_type"] == "concept_rejected_by_knowledge":
                concept_node = node_a if node_a.get("type") == "concept" else node_b
                active_nodes.pop(concept_node["merge_ref"], None)
            else:
                active_nodes.pop(node_a["merge_ref"], None)
                active_nodes.pop(node_b["merge_ref"], None)

            ref_to_node = {
                **active_nodes,
                node_a["merge_ref"]: node_a,
                node_b["merge_ref"]: node_b,
            }
            custom_node = _make_custom_node(conflict, resolution, ref_to_node, root_ref)
            active_nodes[custom_node["merge_ref"]] = custom_node
        else:
            raise HTTPException(400, f"Unsupported resolution choice: {choice}")

    ordered_nodes = sorted(
        active_nodes.values(),
        key=lambda node: (
            0 if node.get("is_root") else 1,
            0 if node["type"] == "concept" else 1,
            0 if node["side"] == "a" else 1 if node["side"] == "b" else 2,
            node.get("sequence", 0),
            node.get("title", "").lower(),
        ),
    )

    ref_to_final_id: dict[str, str] = {}
    concept_counter = 0
    knowledge_counter = 0
    for node in ordered_nodes:
        if node["type"] == "concept":
            if node.get("is_root"):
                ref_to_final_id[node["merge_ref"]] = "C0"
                concept_counter = max(concept_counter, 0)
            else:
                concept_counter += 1
                ref_to_final_id[node["merge_ref"]] = f"C{concept_counter}"
        else:
            knowledge_counter += 1
            ref_to_final_id[node["merge_ref"]] = f"K{knowledge_counter}"

    active_ref_to_node = {node["merge_ref"]: node for node in ordered_nodes}
    entries: list[dict] = []
    for node in ordered_nodes:
        final_id = ref_to_final_id[node["merge_ref"]]
        source_ids = [
            ref_to_final_id[ref]
            for ref in _dedupe_source_refs(
                node.get("source_parent_refs", []),
                active_ref_to_node,
                self_ref=node["merge_ref"],
            )
            if ref in ref_to_final_id
        ]
        parent_id = None
        parent_ref = node.get("parent_ref")
        if parent_ref and parent_ref in ref_to_final_id and parent_ref != node["merge_ref"]:
            parent_id = ref_to_final_id[parent_ref]
        elif node["type"] == "concept" and final_id != "C0" and root_ref and root_ref in ref_to_final_id:
            parent_id = ref_to_final_id[root_ref]

        if parent_id and parent_id not in source_ids:
            source_ids.insert(0, parent_id)

        entries.append(
            {
                "id": final_id,
                "type": node["type"],
                "title": node["title"],
                "desc": node["desc"],
                "operation_rationale": node.get("operation_rationale", ""),
                "parent_id": parent_id,
                "source_parent_ids": source_ids,
                **(
                    {"validation_status": node.get("validationStatus")}
                    if node.get("type") == "concept" and node.get("validationStatus")
                    else {}
                ),
            }
        )

    ck_a = board_a.get("ck_nodes") if isinstance(board_a.get("ck_nodes"), dict) else {}
    confirmed_initial = ck_a.get("confirmedInitialConcept")
    if not confirmed_initial and isinstance(board_b.get("ck_nodes"), dict):
        confirmed_initial = board_b["ck_nodes"].get("confirmedInitialConcept")

    return {
        "entries": entries,
        "confirmedInitialConcept": confirmed_initial,
        "showLineOfThoughtArrows": ck_a.get("showLineOfThoughtArrows", True),
        "showNodeDescriptions": ck_a.get("showNodeDescriptions", True),
        "savedAt": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "total_entries": len(entries),
            "concept_count": sum(1 for entry in entries if entry["type"] == "concept"),
            "knowledge_count": sum(1 for entry in entries if entry["type"] == "knowledge"),
            "resolved_conflicts": len(conflicts),
        },
    }


def _get_session_topic(db: Any, session_id: str) -> str:
    row = (
        db.table("collaboration_sessions")
        .select("initial_concept, requirements")
        .eq("id", session_id)
        .execute()
    )
    if not row.data:
        return "the design project"
    record = row.data[0]
    topic = record["initial_concept"]
    if record.get("requirements"):
        topic += f" (requirements: {record['requirements']})"
    return topic


def _is_missing_merge_table_error(exc: APIError) -> bool:
    code = getattr(exc, "code", None)
    message = ""
    if hasattr(exc, "message"):
        message = str(getattr(exc, "message"))
    elif exc.args:
        message = " ".join(str(arg) for arg in exc.args)
    normalized = message.lower()
    return code == "PGRST205" or "public.merges" in normalized or "public.merge_conflicts" in normalized


def _raise_merge_schema_error(exc: APIError) -> None:
    log.error("Merge schema is missing in Supabase: %s", exc)
    raise HTTPException(
        status_code=503,
        detail=(
            "Merge feature is not initialized in Supabase yet. "
            "Please run the SQL in supabase_schema.sql to create the 'merges' and "
            "'merge_conflicts' tables, then retry."
        ),
    ) from exc


def _is_merge_rls_error(exc: APIError) -> bool:
    code = getattr(exc, "code", None)
    message = ""
    if hasattr(exc, "message"):
        message = str(getattr(exc, "message"))
    elif exc.args:
        message = " ".join(str(arg) for arg in exc.args)
    normalized = message.lower()
    return (
        code == "42501"
        and "row-level security policy" in normalized
        and ("table \"merges\"" in normalized or "table \"merge_conflicts\"" in normalized)
    )


def _raise_merge_rls_error(exc: APIError) -> None:
    log.error("Merge tables are blocked by Supabase RLS: %s", exc)
    raise HTTPException(
        status_code=503,
        detail=(
            "Supabase row-level security is blocking the merge tables. "
            "Please disable RLS on 'merges' and 'merge_conflicts', or add insert/select/update "
            "policies for them, then retry."
        ),
    ) from exc


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
    choice: str  # "a" | "b" | "both" | "custom"
    custom_title: str | None = None
    custom_desc: str | None = None


class ResolveConflictsRequest(BaseModel):
    merge_id: str
    resolutions: list[ConflictResolution]


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.get("/status/{session_id}", response_model=MergeStatusResponse)
async def merge_status(session_id: str, user: dict = Depends(get_current_user)):
    db = get_supabase()

    try:
        members = db.table("session_members").select("user_id").eq("session_id", session_id).execute()
        if len(members.data) < 2:
            return MergeStatusResponse(ready=False, reason="Waiting for a second collaborator to join.")

        boards = db.table("boards").select("user_id, pushed_at").eq("session_id", session_id).execute()
        pushed = [board for board in boards.data if board["pushed_at"]]
        if len(pushed) < 2:
            return MergeStatusResponse(ready=False, reason="Both collaborators must push before merging.")

        existing = db.table("merges").select("*").eq("session_id", session_id).execute()
        if existing.data:
            merge = existing.data[0]
            if merge["status"] != "done":
                return MergeStatusResponse(
                    ready=True,
                    reason="A merge is already in progress.",
                    merge_id=merge["id"],
                    status=merge["status"],
                )
            merged_at = merge["completed_at"]
            if merged_at and all(board["pushed_at"] <= merged_at for board in pushed):
                return MergeStatusResponse(
                    ready=True,
                    reason="Latest merged board is available.",
                    merge_id=merge["id"],
                    status=merge["status"],
                )

        return MergeStatusResponse(ready=True, reason="Ready to merge.")
    except APIError as exc:
        if _is_missing_merge_table_error(exc):
            _raise_merge_schema_error(exc)
        if _is_merge_rls_error(exc):
            _raise_merge_rls_error(exc)
        raise


@router.post("/start")
async def start_merge(req: StartMergeRequest, user: dict = Depends(get_current_user)):
    db = get_supabase()
    try:
        boards = _load_boards_with_owners(db, req.session_id)
        board_a, board_b = boards[0], boards[1]

        nodes_a = _normalize_board_nodes(board_a, "a")
        nodes_b = _normalize_board_nodes(board_b, "b")

        concepts_a = [node for node in nodes_a if node["type"] == "concept" and not node.get("is_root")]
        concepts_b = [node for node in nodes_b if node["type"] == "concept" and not node.get("is_root")]
        knowledge_a = [node for node in nodes_a if node["type"] == "knowledge"]
        knowledge_b = [node for node in nodes_b if node["type"] == "knowledge"]

        existing = db.table("merges").select("id").eq("session_id", req.session_id).execute()
        if existing.data:
            merge_id = existing.data[0]["id"]
            db.table("merges").update(
                {
                    "initiator_id": user["sub"],
                    "status": "detecting",
                    "merged_ck_state": None,
                    "completed_at": None,
                }
            ).eq("id", merge_id).execute()
            db.table("merge_conflicts").delete().eq("merge_id", merge_id).execute()
        else:
            result = db.table("merges").insert(
                {
                    "session_id": req.session_id,
                    "initiator_id": user["sub"],
                    "status": "detecting",
                }
            ).execute()
            merge_id = result.data[0]["id"]

        prompt = CKPromptEngine.detect_merge_conflicts(
            topic=_get_session_topic(db, req.session_id),
            concepts_a_json=json.dumps(_llm_node_summary(concepts_a), indent=2),
            concepts_b_json=json.dumps(_llm_node_summary(concepts_b), indent=2),
            knowledge_a_json=json.dumps(_llm_node_summary(knowledge_a), indent=2),
            knowledge_b_json=json.dumps(_llm_node_summary(knowledge_b), indent=2),
            owner_a=board_a["owner_name"],
            owner_b=board_b["owner_name"],
        )

        try:
            detected_conflicts = _json_llm(
                prompt,
                "You are a C-K Theory merge expert. Return only valid JSON.",
            )
            log.info(
                "LLM merge detection returned %s raw conflicts for session %s: %s",
                len(detected_conflicts) if isinstance(detected_conflicts, list) else "non-list payload",
                req.session_id,
                json.dumps(detected_conflicts, ensure_ascii=False, indent=2),
            )
        except Exception as exc:
            log.error("LLM merge conflict detection failed: %s", exc)
            detected_conflicts = []

        node_lookup = {node["merge_ref"]: node for node in [*nodes_a, *nodes_b]}
        conflict_rows: list[dict] = []
        for conflict in detected_conflicts if isinstance(detected_conflicts, list) else []:
            conflict_type = conflict.get("conflict_type")
            node_a_id = conflict.get("node_a_id")
            node_b_id = conflict.get("node_b_id")
            if (
                conflict_type not in MERGE_CONFLICT_TYPES
                or node_a_id not in node_lookup
                or node_b_id not in node_lookup
            ):
                continue

            node_a = node_lookup[node_a_id]
            node_b = node_lookup[node_b_id]
            if _is_same_shared_root(node_a, node_b):
                continue

            suggestion = conflict.get("suggested_resolution") or {}
            conflict_rows.append(
                {
                    "merge_id": merge_id,
                    "conflict_type": conflict_type,
                    "step": 1,
                    "node_a": _build_conflict_payload(node_a),
                    "node_b": _build_conflict_payload(node_b),
                    "explanation": str(conflict.get("explanation", "")).strip(),
                    "resolution": {
                        "suggested_choice": suggestion.get("choice"),
                        "suggested_title": suggestion.get("title"),
                        "suggested_desc": suggestion.get("desc"),
                        "suggested_rationale": suggestion.get("rationale"),
                    },
                }
            )

        log.info(
            "LLM merge detection kept %d validated conflicts for merge %s: %s",
            len(conflict_rows),
            merge_id,
            json.dumps(
                [
                    {
                        "conflict_type": row["conflict_type"],
                        "node_a": row["node_a"].get("id"),
                        "node_b": row["node_b"].get("id"),
                        "explanation": row["explanation"],
                        "suggested_resolution": row["resolution"],
                    }
                    for row in conflict_rows
                ],
                ensure_ascii=False,
                indent=2,
            ),
        )

        if conflict_rows:
            db.table("merge_conflicts").insert(conflict_rows).execute()

        db.table("merges").update({"status": "conflict_review"}).eq("id", merge_id).execute()
        conflicts_out = db.table("merge_conflicts").select("*").eq("merge_id", merge_id).execute()

        return {
            "id": merge_id,
            "session_id": req.session_id,
            "status": "conflict_review",
            "merged_ck_state": None,
            "conflicts": _serialize_conflicts(conflicts_out.data),
        }
    except APIError as exc:
        if _is_missing_merge_table_error(exc):
            _raise_merge_schema_error(exc)
        if _is_merge_rls_error(exc):
            _raise_merge_rls_error(exc)
        raise


@router.post("/resolve")
async def resolve_merge(req: ResolveConflictsRequest, user: dict = Depends(get_current_user)):
    db = get_supabase()
    try:
        merge = db.table("merges").select("*").eq("id", req.merge_id).execute()
        if not merge.data:
            raise HTTPException(404, "Merge not found.")

        merge_record = merge.data[0]
        session_id = merge_record["session_id"]

        existing_conflicts = (
            db.table("merge_conflicts")
            .select("*")
            .eq("merge_id", req.merge_id)
            .order("created_at")
            .execute()
        )
        conflict_rows = existing_conflicts.data

        resolution_by_id = {resolution.conflict_id: resolution for resolution in req.resolutions}
        missing_conflicts = [
            row["id"] for row in conflict_rows if row["id"] not in resolution_by_id
        ]
        if missing_conflicts:
            raise HTTPException(400, "Resolve every conflict before creating the merged board.")

        now = datetime.now(timezone.utc).isoformat()
        for row in conflict_rows:
            resolution = resolution_by_id[row["id"]]
            if resolution.choice not in ("a", "b", "both", "custom"):
                raise HTTPException(400, f"Unsupported resolution choice: {resolution.choice}")
            if resolution.choice == "custom" and not (resolution.custom_title or "").strip():
                raise HTTPException(400, "Custom resolutions require a title.")

            stored_resolution = row.get("resolution") or {}
            db.table("merge_conflicts").update(
                {
                    "resolution": {
                        **stored_resolution,
                        "choice": resolution.choice,
                        "custom_title": resolution.custom_title,
                        "custom_desc": resolution.custom_desc,
                    },
                    "resolved_at": now,
                }
            ).eq("id", row["id"]).execute()

        boards = _load_boards_with_owners(db, session_id)
        board_a, board_b = boards[0], boards[1]
        refreshed_conflicts = db.table("merge_conflicts").select("*").eq("merge_id", req.merge_id).execute()
        merged_ck_state = _assemble_merged_entries(refreshed_conflicts.data, board_a, board_b)

        db.table("merges").update(
            {
                "status": "done",
                "merged_ck_state": merged_ck_state,
                "completed_at": now,
            }
        ).eq("id", req.merge_id).execute()

        return {
            "id": req.merge_id,
            "session_id": session_id,
            "status": "done",
            "merged_ck_state": merged_ck_state,
            "conflicts": _serialize_conflicts(refreshed_conflicts.data),
        }
    except APIError as exc:
        if _is_missing_merge_table_error(exc):
            _raise_merge_schema_error(exc)
        if _is_merge_rls_error(exc):
            _raise_merge_rls_error(exc)
        raise


@router.get("/state/{merge_id}")
async def get_merge_state(merge_id: str, user: dict = Depends(get_current_user)):
    db = get_supabase()
    try:
        merge = db.table("merges").select("*").eq("id", merge_id).execute()
        if not merge.data:
            raise HTTPException(404, "Merge not found.")

        conflicts = db.table("merge_conflicts").select("*").eq("merge_id", merge_id).execute()
        return {
            **merge.data[0],
            "conflicts": _serialize_conflicts(conflicts.data),
        }
    except APIError as exc:
        if _is_missing_merge_table_error(exc):
            _raise_merge_schema_error(exc)
        if _is_merge_rls_error(exc):
            _raise_merge_rls_error(exc)
        raise
