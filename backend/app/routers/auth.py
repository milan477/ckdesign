import re

from fastapi import APIRouter, HTTPException
from passlib.context import CryptContext
from pydantic import BaseModel

from backend.app.core.security import create_token
from backend.app.db.supabase_client import get_supabase

router = APIRouter(prefix="/auth", tags=["auth"])

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_-]{3,32}$")


class SignupRequest(BaseModel):
    username: str
    password: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str | None = None


class AuthResponse(BaseModel):
    token: str
    user_id: str
    username: str


@router.post("/signup", response_model=AuthResponse)
async def signup(req: SignupRequest):
    if not _USERNAME_RE.match(req.username):
        raise HTTPException(400, "Username must be 3-32 chars: letters, numbers, _ or -")

    db = get_supabase()

    existing = db.table("users").select("id").eq("username", req.username).execute()
    if existing.data:
        raise HTTPException(400, "Username already taken")

    password_hash = _pwd.hash(req.password) if req.password else None
    result = db.table("users").insert({"username": req.username, "password_hash": password_hash}).execute()

    user = result.data[0]
    return AuthResponse(
        token=create_token(user["id"], user["username"]),
        user_id=user["id"],
        username=user["username"],
    )


@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest):
    db = get_supabase()

    result = db.table("users").select("*").eq("username", req.username).execute()
    if not result.data:
        raise HTTPException(401, "Invalid username or password")

    user = result.data[0]

    if user["password_hash"]:
        if not req.password or not _pwd.verify(req.password, user["password_hash"]):
            raise HTTPException(401, "Invalid username or password")

    return AuthResponse(
        token=create_token(user["id"], user["username"]),
        user_id=user["id"],
        username=user["username"],
    )
