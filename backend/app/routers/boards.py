from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.app.core.security import get_current_user
from backend.app.db.supabase_client import get_supabase

router = APIRouter(prefix="/boards", tags=["boards"])


class SaveBoardRequest(BaseModel):
    session_id: str
    elements: list[Any] = []
    app_state: dict[str, Any] = {}
    ck_nodes: Any = []


@router.put("/save")
async def save_board(req: SaveBoardRequest, user: dict = Depends(get_current_user)):
    db = get_supabase()

    current = (
        db.table("boards")
        .select("version")
        .eq("session_id", req.session_id)
        .eq("user_id", user["sub"])
        .execute()
    )
    version = (current.data[0]["version"] + 1) if current.data else 1

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

    return {"ok": True, "version": version}


@router.post("/push")
async def push_board(req: SaveBoardRequest, user: dict = Depends(get_current_user)):
    db = get_supabase()

    db.table("boards").update(
        {
            "elements": req.elements,
            "app_state": req.app_state,
            "ck_nodes": req.ck_nodes,
            "pushed_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("session_id", req.session_id).eq("user_id", user["sub"]).execute()

    return {"ok": True}


@router.get("/{session_id}")
async def get_board(session_id: str, user: dict = Depends(get_current_user)):
    db = get_supabase()

    result = (
        db.table("boards")
        .select("*")
        .eq("session_id", session_id)
        .eq("user_id", user["sub"])
        .execute()
    )
    return result.data[0] if result.data else None
