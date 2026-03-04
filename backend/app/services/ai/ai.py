
import os
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI


class Client:
    pass

class OpenAIClient(Client):
    def __init__(self, llm_model: str = "gpt-4.1"):
        project_root = Path(__file__).resolve().parents[4]
        env_candidates = [
            Path.cwd() / "api_key.env",
            project_root / "api_key.env",
        ]
        for env_path in env_candidates:
            if env_path.exists():
                load_dotenv(env_path)
                break
        api_key = os.getenv("OPENAI_API_KEY")

        if not api_key:
            raise ValueError("OPENAI_API_KEY not found in environment variables. Please create api_key.env file with your API key.")

        self.client = OpenAI(api_key=api_key)
        self.llm_model = llm_model
