import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client


def _load_env() -> None:
    candidates = [
        Path.cwd() / "api_key.env",
        Path(__file__).resolve().parents[4] / "api_key.env",
    ]
    for path in candidates:
        if path.exists():
            load_dotenv(path)
            return


_load_env()


def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in api_key.env")
    return create_client(url, key)
