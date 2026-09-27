from pathlib import Path
from typing import List

import requests
from fastapi import FastAPI
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

OLLAMA_URL = "http://127.0.0.1:11434"
MODEL = "qwen3:8b"
OLLAMA_TIMEOUT =600

SYSTEM_PROMPT = """You are LocalMind, a private local AI assistant.
You run locally through Ollama.
Be accurate, direct, and useful.
If you do not know something, say so instead of inventing facts.
Use clear structure when it helps.
Do not claim to have internet access.
"""

app = FastAPI(title="LocalMind Offline AI", version="1.0.0")


class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=12000)
    history: List[Message] = Field(default_factory=list)


def ollama_get(path: str):
    return requests.get(f"{OLLAMA_URL}{path}", timeout=10)


def ollama_chat(messages: list[dict]):
    response = requests.post(
        f"{OLLAMA_URL}/api/chat",
        json={
            "model": MODEL,
            "messages": messages,
            "stream": False,
            "think": False,
            "options": {
            "temperature": 0.4,
        },
    },
    timeout=OLLAMA_TIMEOUT,
)
    response.raise_for_status()
    return response.json()


@app.get("/")
def home():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/styles.css")
def styles():
    return FileResponse(FRONTEND_DIR / "styles.css", media_type="text/css")


@app.get("/app.js")
def javascript():
    return FileResponse(FRONTEND_DIR / "app.js", media_type="application/javascript")


@app.get("/api/health")
def health():
    result = {
        "backend": "online",
        "ollama": False,
        "model": MODEL,
        "model_available": False,
    }
    try:
        ollama_get("/api/tags")
        result["ollama"] = True
        data = ollama_get("/api/tags").json()
        names = [m.get("name", "") for m in data.get("models", [])]
        result["model_available"] = MODEL in names
    except requests.RequestException:
        pass
    return result


@app.get("/api/models")
def models():
    try:
        data = ollama_get("/api/tags").json()
        return {
            "models": [m.get("name") for m in data.get("models", [])],
            "selected": MODEL,
        }
    except requests.RequestException as exc:
        return {
            "models": [],
            "selected": MODEL,
            "error": str(exc),
        }


@app.post("/api/chat")
def chat(request: ChatRequest):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    for item in request.history[-12:]:
        if item.role in {"user", "assistant"}:
            messages.append({"role": item.role, "content": item.content})

    messages.append({"role": "user", "content": request.message})

    try:
        data = ollama_chat(messages)
        content = data.get("message", {}).get("content", "").strip()
        if not content:
            return {
                "ok": False,
                "error": "The local model returned an empty response.",
            }

        return {
            "ok": True,
            "model": MODEL,
            "response": content,
        }

    except requests.exceptions.ConnectionError:
        return {
            "ok": False,
            "error": (
                "Ollama is not running. Open Ollama, or run "
                "'ollama serve' in another terminal, then try again."
            ),
        }

    except requests.exceptions.Timeout:
        return {
            "ok": False,
            "error": (
                "The model took too long to answer. The laptop is using local "
                "CPU inference, so try a shorter prompt."
            ),
        }

    except requests.exceptions.HTTPError as exc:
        detail = ""
        try:
            detail = exc.response.json().get("error", "")
        except Exception:
            pass
        return {
            "ok": False,
            "error": detail or "Ollama returned an HTTP error.",
        }

    except Exception as exc:
        return {
            "ok": False,
            "error": f"Unexpected backend error: {exc}",
        }
