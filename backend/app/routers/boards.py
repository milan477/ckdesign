from datetime import datetime, timezone
import logging
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.app.core.security import get_current_user
from backend.app.db.supabase_client import get_supabase

router = APIRouter(prefix="/boards", tags=["boards"])
log = logging.getLogger(__name__)


class SaveBoardRequest(BaseModel):
    session_id: str
    elements: list[Any] = []
    app_state: dict[str, Any] = {}
    ck_nodes: Any = []


def _count_ck_nodes(value: Any) -> int:
    if isinstance(value, dict) and isinstance(value.get("nodes"), list):
        return len(value["nodes"])
    if isinstance(value, list):
        return len(value)
    return 0


def _element_count(value: Any) -> int:
    return len(value) if isinstance(value, list) else 0


def _pick_best_board(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not rows:
        return None

    for row in rows:
        if _count_ck_nodes(row.get("ck_nodes")) > 0:
            return row

    for row in rows:
        if _element_count(row.get("elements")) > 0:
            return row

    return rows[0]


def _should_reject_regressive_autosave(
    existing_board: dict[str, Any] | None,
    incoming_elements: list[Any],
    incoming_ck_nodes: Any,
) -> bool:
    if not existing_board:
        return False

    existing_node_count = _count_ck_nodes(existing_board.get("ck_nodes"))
    incoming_node_count = _count_ck_nodes(incoming_ck_nodes)
    existing_element_count = _element_count(existing_board.get("elements"))
    incoming_element_count = _element_count(incoming_elements)

    # Protect against startup races where a richer saved board gets overwritten
    # by an empty or root-only autosave before hydration finishes.
    if existing_node_count > 1 and incoming_node_count <= 1:
        return True

    if existing_element_count > 0 and incoming_element_count == 0 and incoming_node_count == 0:
        return True

    return False


@router.put("/save")
async def save_board(req: SaveBoardRequest, user: dict = Depends(get_current_user)):
    db = get_supabase()

    current = (
        db.table("boards")
        .select("*")
        .eq("session_id", req.session_id)
        .eq("user_id", user["sub"])
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    existing_board = current.data[0] if current.data else None

    if _should_reject_regressive_autosave(existing_board, req.elements, req.ck_nodes):
        log.warning(
            "Rejected regressive autosave for session=%s user=%s existing_elements=%d existing_ck_nodes=%d incoming_elements=%d incoming_ck_nodes=%d",
            req.session_id,
            user["sub"],
            _element_count(existing_board.get("elements")) if existing_board else 0,
            _count_ck_nodes(existing_board.get("ck_nodes")) if existing_board else 0,
            len(req.elements),
            _count_ck_nodes(req.ck_nodes),
        )
        return {
            "ok": True,
            "version": existing_board.get("version", 1) if existing_board else 1,
            "preserved_existing": True,
        }

    version = (existing_board["version"] + 1) if existing_board else 1

    db.table("boards").upsert(
        {
            "session_id": req.session_id,
            "user_id": user["sub"],
            "elements": req.elements,
            "app_state": req.app_state,
            "ck_nodes": req.ck_nodes,
            "version": version,
        },
        on_conflict="session_id,user_id",
    ).execute()

    log.info(
        "Saved board for session=%s user=%s version=%s elements=%d ck_nodes=%d",
        req.session_id,
        user["sub"],
        version,
        len(req.elements),
        _count_ck_nodes(req.ck_nodes),
    )

    return {"ok": True, "version": version}


@router.post("/push")
async def push_board(req: SaveBoardRequest, user: dict = Depends(get_current_user)):
    db = get_supabase()

    current = (
        db.table("boards")
        .select("version")
        .eq("session_id", req.session_id)
        .eq("user_id", user["sub"])
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    version = current.data[0]["version"] if current.data else 1

    db.table("boards").upsert(
        {
            "session_id": req.session_id,
            "user_id": user["sub"],
            "elements": req.elements,
            "app_state": req.app_state,
            "ck_nodes": req.ck_nodes,
            "version": version,
            "pushed_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="session_id,user_id",
    ).execute()

    log.info(
        "Pushed board for session=%s user=%s version=%s elements=%d ck_nodes=%d",
        req.session_id,
        user["sub"],
        version,
        len(req.elements),
        _count_ck_nodes(req.ck_nodes),
    )

    return {"ok": True}


@router.get("/{session_id}")
async def get_board(session_id: str, user: dict = Depends(get_current_user)):
    db = get_supabase()

    result = (
        db.table("boards")
        .select("*")
        .eq("session_id", session_id)
        .eq("user_id", user["sub"])
        .order("updated_at", desc=True)
        .execute()
    )
    board = _pick_best_board(result.data)

    log.info(
        "Loaded board for session=%s user=%s found=%s matched_rows=%d elements=%d ck_nodes=%d chosen_board_id=%s",
        session_id,
        user["sub"],
        bool(board),
        len(result.data),
        _element_count(board.get("elements")) if isinstance(board, dict) else 0,
        _count_ck_nodes(board.get("ck_nodes")) if isinstance(board, dict) else 0,
        board.get("id") if isinstance(board, dict) else None,
    )

    return board
