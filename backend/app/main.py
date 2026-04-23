import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # nginx is the public entry point; FastAPI only reachable internally
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "Welcome to our Platform"}


from backend.app.routers import nodes
from backend.app.routers import auth, boards, sessions, merge

app.include_router(nodes.router)
app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(boards.router)
app.include_router(merge.router)
