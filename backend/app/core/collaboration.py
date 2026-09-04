from typing import Any

from fastapi import HTTPException


def get_session_members(db: Any, session_id: str) -> list[dict]:
    result = (
        db.table("session_members")
        .select("user_id, role, joined_at")
        .eq("session_id", session_id)
        .order("joined_at")
        .execute()
    )
    return result.data or []


def require_session_member(db: Any, session_id: str, user_id: str) -> dict:
    members = get_session_members(db, session_id)
    member = next((row for row in members if row["user_id"] == user_id), None)
    if member is None:
        raise HTTPException(403, "You are not a member of this collaboration session.")
    return member
