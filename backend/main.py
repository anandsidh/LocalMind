from pathlib import Path
import os
import re
import subprocess
import sys
import tempfile

import requests
from fastapi import FastAPI
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parent.parent
DIST = BASE / "frontend" / "dist"
OLLAMA = "http://127.0.0.1:11434"
MODEL = "qwen3:8b"

app = FastAPI(title="LocalMind Code Studio")


class Chat(BaseModel):
    message: str = Field(min_length=1, max_length=12000)
    code: str = Field(default="", max_length=200000)
    selection: str = Field(default="", max_length=50000)


class Run(BaseModel):
    code: str = Field(max_length=200000)
    language: str = "python"


def parse_python_error(stderr: str, stdout: str = "") -> dict:
    """Extract a readable error summary from a Python traceback."""
    raw = stderr or ""
    lines = raw.splitlines()
    file_path = "main.py"
    line_no = None
    column_no = None
    code_line = ""
    error_type = "RuntimeError"
    message = raw.strip() or "Program exited with an error."

    file_matches = list(re.finditer(r'File "([^"]+)", line (\d+)', raw))
    if file_matches:
        match = file_matches[-1]
        file_path = Path(match.group(1)).name
        line_no = int(match.group(2))
        start = max(0, match.start() - 250)
        context_lines = raw[start:match.end() + 350].splitlines()
        try:
            idx = next(i for i, x in enumerate(context_lines) if 'line ' + match.group(2) in x)
            if idx + 1 < len(context_lines):
                candidate = context_lines[idx + 1]
                # Skip another traceback marker if present.
                if candidate.strip() and not candidate.lstrip().startswith('File "'):
                    code_line = candidate.rstrip()
            # SyntaxError caret is usually after the source line.
            if idx + 2 < len(context_lines):
                caret = context_lines[idx + 2]
                if "^" in caret:
                    column_no = caret.index("^") + 1
        except StopIteration:
            pass

    # The final exception line normally contains TypeError: message, etc.
    for line in reversed(lines):
        cleaned = line.strip()
        match = re.match(r"([A-Za-z_][\w.]*(?:Error|Exception|Interrupt|Exit)):\s*(.*)$", cleaned)
        if match:
            error_type = match.group(1).split(".")[-1]
            message = match.group(2) or error_type
            break
        if cleaned.startswith("SyntaxError") or cleaned.startswith("IndentationError"):
            parts = cleaned.split(":", 1)
            error_type = parts[0]
            message = parts[1].strip() if len(parts) > 1 else error_type
            break

    # Syntax errors can have the line number on the SyntaxError line rather than a traceback frame.
    if line_no is None:
        syntax_match = re.search(r'(?:line|at line)\s+(\d+)', raw)
        if syntax_match:
            line_no = int(syntax_match.group(1))

    if not code_line and line_no and stdout:
        src_lines = stdout.splitlines()
        if 0 < line_no <= len(src_lines):
            code_line = src_lines[line_no - 1]

    return {
        "type": error_type,
        "message": message,
        "file": file_path,
        "line": line_no,
        "column": column_no,
        "code": code_line,
        "raw": raw,
    }


def run_py(code: str) -> dict:
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "main.py"
        p.write_text(code, encoding="utf-8")
        try:
            # Use the same interpreter that is running FastAPI, so the project venv is respected.
            r = subprocess.run(
                [sys.executable, str(p)],
                cwd=td,
                capture_output=True,
                text=True,
                timeout=10,
                env=os.environ.copy(),
            )
            result = {
                "ok": r.returncode == 0,
                "exit_code": r.returncode,
                "stdout": r.stdout,
                "stderr": r.stderr,
            }
            if r.returncode != 0:
                result["diagnostic"] = parse_python_error(r.stderr, r.stdout)
            return result
        except subprocess.TimeoutExpired as e:
            stderr = "Execution timed out after 10 seconds."
            return {
                "ok": False,
                "exit_code": -1,
                "stdout": e.stdout or "",
                "stderr": stderr,
                "diagnostic": {
                    "type": "TimeoutError",
                    "message": stderr,
                    "file": "main.py",
                    "line": None,
                    "column": None,
                    "code": "",
                    "raw": stderr,
                },
            }
        except Exception as e:
            message = str(e)
            return {
                "ok": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": message,
                "diagnostic": {
                    "type": type(e).__name__,
                    "message": message,
                    "file": "main.py",
                    "line": None,
                    "column": None,
                    "code": "",
                    "raw": message,
                },
            }


@app.get("/")
def home():
    return FileResponse(DIST / "index.html")


@app.get("/{path:path}")
def static(path: str):
    p = DIST / path
    return FileResponse(p if p.is_file() else DIST / "index.html")


@app.get("/api/health")
def health():
    try:
        d = requests.get(f"{OLLAMA}/api/tags", timeout=5).json()
        names = [m.get("name", "") for m in d.get("models", [])]
        return {
            "backend": True,
            "ollama": True,
            "model": MODEL,
            "model_available": MODEL in names,
        }
    except Exception:
        return {
            "backend": True,
            "ollama": False,
            "model": MODEL,
            "model_available": False,
        }


@app.post("/api/run")
def run(r: Run):
    if r.language.lower() not in {"python", "py"}:
        return {
            "ok": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"{r.language} execution is not implemented yet. Python is supported.",
            "diagnostic": {
                "type": "UnsupportedLanguageError",
                "message": f"{r.language} execution is not implemented yet. Python is supported.",
                "file": "main.py",
                "line": None,
                "column": None,
                "code": "",
                "raw": f"{r.language} execution is not implemented yet. Python is supported.",
            },
        }
    return run_py(r.code)


@app.post("/api/chat")
def chat(r: Chat):
    msg = r.message
    if r.code:
        msg += "\n\nCURRENT EDITOR CODE:\n```python\n" + r.code + "\n```"
    if r.selection:
        msg += "\n\nSELECTED CODE FROM EDITOR:\n```python\n" + r.selection + "\n```"

    try:
        x = requests.post(
            f"{OLLAMA}/api/chat",
            json={
                "model": MODEL,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are LocalMind Code Agent, a local coding assistant. "
                            "Give practical, readable answers. Use Markdown for headings, lists, "
                            "inline code, and fenced code blocks. Inspect supplied code for bugs "
                            "and fixes. Never claim internet access. When selected code is supplied, "
                            "focus on it first."
                        ),
                    },
                    {"role": "user", "content": msg},
                ],
                "stream": False,
                "think": False,
                "options": {"temperature": 0.25},
            },
            timeout=600,
        )
        x.raise_for_status()
        return {"ok": True, "response": x.json().get("message", {}).get("content", "")}
    except requests.exceptions.ConnectionError:
        return {
            "ok": False,
            "error": "Ollama is not running. Start Ollama or run 'ollama serve'.",
        }
    except requests.exceptions.Timeout:
        return {"ok": False, "error": "Qwen3 8B took too long to answer. Try a shorter request."}
    except Exception as e:
        return {"ok": False, "error": str(e)}
