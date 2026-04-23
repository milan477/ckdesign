import random
import string

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.app.core.security import get_current_user
from backend.app.db.supabase_client import get_supabase

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _gen_code(length: int = 6) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))


class CreateSessionRequest(BaseModel):
    initial_concept: str
    requirements: str | None = None


class JoinSessionRequest(BaseModel):
    session_code: str


@router.post("/create")
async def create_session(req: CreateSessionRequest, user: dict = Depends(get_current_user)):
    db = get_supabase()

    # Generate a unique session code
    code = _gen_code()
    for _ in range(9):
        if not db.table("collaboration_sessions").select("id").eq("session_code", code).execute().data:
            break
        code = _gen_code()

    session = db.table("collaboration_sessions").insert({
        "session_code": code,
        "creator_id": user["sub"],
        "initial_concept": req.initial_concept,
        "requirements": req.requirements,
        "status": "active",
    }).execute().data[0]

    db.table("session_members").insert({
        "session_id": session["id"],
        "user_id": user["sub"],
        "role": "creator",
    }).execute()

    db.table("boards").insert({
        "session_id": session["id"],
        "user_id": user["sub"],
        "elements": [],
        "app_state": {},
        "ck_nodes": [],
    }).execute()

    return {**session, "role": "creator"}


@router.post("/join")
async def join_session(req: JoinSessionRequest, user: dict = Depends(get_current_user)):
    db = get_supabase()

    result = db.table("collaboration_sessions").select("*").eq("session_code", req.session_code.upper()).execute()
    if not result.data:
        raise HTTPException(404, "Session not found — check the code and try again")

    session = result.data[0]

    existing_member = (
        db.table("session_members")
        .select("role")
        .eq("session_id", session["id"])
        .eq("user_id", user["sub"])
        .execute()
    )

    if existing_member.data:
        role = existing_member.data[0]["role"]
    else:
        db.table("session_members").insert({
            "session_id": session["id"],
            "user_id": user["sub"],
            "role": "member",
        }).execute()

        db.table("boards").insert({
            "session_id": session["id"],
            "user_id": user["sub"],
            "elements": [],
            "app_state": {},
            "ck_nodes": [],
        }).execute()

        role = "member"

    return {**session, "role": role}


@router.get("/mine")
async def get_my_sessions(user: dict = Depends(get_current_user)):
    db = get_supabase()

    members = db.table("session_members").select("session_id, role").eq("user_id", user["sub"]).execute()
    if not members.data:
        return []

    session_ids = [m["session_id"] for m in members.data]
    roles = {m["session_id"]: m["role"] for m in members.data}

    sessions = db.table("collaboration_sessions").select("*").in_("id", session_ids).order("created_at", desc=True).execute()

    return [{**s, "role": roles[s["id"]]} for s in sessions.data]
