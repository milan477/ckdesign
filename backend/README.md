# CK Backend (FastAPI)

This backend hosts the CK agent routes used by the Excalidraw integration.

## Endpoints

- `GET /`
- `POST /nodes/generate`
- `POST /nodes/simulate`
- `POST /nodes/reorder`
- `POST /nodes/create-concept` (runs a single `k_to_c` and returns one concept)
- `POST /nodes/expand-concept` (runs C->C expansion and returns 2-3 child concepts)

## Setup

```bash
cd /Users/apple/Desktop/ckdesign
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
```

## API key

Create `/Users/apple/Desktop/ckdesign/api_key.env`:

```bash
OPENAI_API_KEY=your_key_here
```

## Run

```bash
cd /Users/apple/Desktop/ckdesign
source backend/.venv/bin/activate
fastapi dev backend/app/main.py --port 3016
```

Use `3016` because Excalidraw is configured to call `VITE_APP_AI_BACKEND=http://localhost:3016`.
