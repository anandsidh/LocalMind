from pathlib import Path
import os
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Optional

import requests
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parent.parent
DIST = BASE / "frontend" / "dist"
OLLAMA = "http://127.0.0.1:11434"
MODEL = "qwen3:8b"
IGNORED_DIRS = {".git", ".venv", "node_modules", "dist", "__pycache__", ".pytest_cache"}

app = FastAPI(title="LocalMind Code Studio")


class Chat(BaseModel):
    message: str = Field(min_length=1, max_length=12000)
    code: str = Field(default="", max_length=200000)
    selection: str = Field(default="", max_length=50000)


class Run(BaseModel):
    code: str = Field(max_length=200000)
    language: str = "python"


class TerminalCommand(BaseModel):
    command: str = Field(min_length=1, max_length=5000)


class FileWrite(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    content: str = Field(max_length=500000)


class FixRequest(BaseModel):
    code: str = Field(max_length=200000)
    error: str = Field(max_length=30000)
    language: str = "python"


def safe_project_path(relative_path: str) -> Path:
    clean = (relative_path or "").replace("\\", "/").lstrip("/")
    target = (BASE / clean).resolve()
    try:
        target.relative_to(BASE.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Path is outside the LocalMind project.")
    if any(part in IGNORED_DIRS for part in target.relative_to(BASE.resolve()).parts):
        raise HTTPException(status_code=403, detail="Access to this project directory is restricted.")
    return target


def parse_error(stderr: str, language: str = "python") -> dict:
    raw = stderr or ""
    lines = raw.splitlines()
    file_path = "main.py"
    line_no: Optional[int] = None
    column_no: Optional[int] = None
    code_line = ""
    error_type = "RuntimeError"
    message = raw.strip() or "Program exited with an error."

    # Python traceback / SyntaxError
    file_matches = list(re.finditer(r'File "([^\"]+)", line (\d+)', raw))
    if file_matches:
        match = file_matches[-1]
        file_path = Path(match.group(1)).name
        line_no = int(match.group(2))
        context_lines = raw[max(0, match.start() - 250): match.end() + 400].splitlines()
        for idx, item in enumerate(context_lines):
            if 'line ' + str(line_no) in item:
                if idx + 1 < len(context_lines) and context_lines[idx + 1].strip():
                    code_line = context_lines[idx + 1].strip()
                if idx + 2 < len(context_lines) and "^" in context_lines[idx + 2]:
                    column_no = context_lines[idx + 2].index("^") + 1
                break

    # JavaScript, C, C++, Java compiler/runtime line formats
    line_patterns = [
        r"(?:^|\n).*?:(\d+):(\d+):\s*(?:error|warning):\s*(.+)",
        r"(?:^|\n).*?:(\d+):\s*(?:error|warning):\s*(.+)",
        r"[\(]?(?:[^():]+\()?([\w.-]+\.\w+):(\d+)(?::(\d+))?[\)]?",
        r"(?:Main\.java|\.java):(\d+):\s*(.+)",
    ]
    if language.lower() in {"c", "cpp", "c++", "javascript", "js", "java"} and line_no is None:
        for pattern in line_patterns:
            m = re.search(pattern, raw, re.MULTILINE)
            if not m:
                continue
            groups = m.groups()
            nums = [g for g in groups if g and g.isdigit()]
            if nums:
                line_no = int(nums[0])
            if len(nums) > 1:
                column_no = int(nums[1])
            file_candidates = [g for g in groups if g and "." in g and not g.isdigit()]
            if file_candidates:
                file_path = Path(file_candidates[0]).name
            break

    # Final exception/error line.
    for line in reversed(lines):
        cleaned = line.strip()
        match = re.match(r"([A-Za-z_][\w.]*(?:Error|Exception|Warning|Interrupt|Exit))(?::\s*(.*))?$", cleaned)
        if match:
            error_type = match.group(1).split(".")[-1]
            message = match.group(2) or error_type
            break
        if " error:" in cleaned.lower():
            left, right = re.split(r"\berror:\s*", cleaned, maxsplit=1, flags=re.I)
            error_type = "CompileError"
            message = right.strip() or "Compilation failed."
            break
        if cleaned.startswith("SyntaxError") or cleaned.startswith("IndentationError"):
            parts = cleaned.split(":", 1)
            error_type = parts[0]
            message = parts[1].strip() if len(parts) > 1 else error_type
            break

    if line_no is None:
        syntax_match = re.search(r"(?:line|at line)\s+(\d+)", raw, flags=re.I)
        if syntax_match:
            line_no = int(syntax_match.group(1))

    return {
        "type": error_type,
        "message": message,
        "file": file_path,
        "line": line_no,
        "column": column_no,
        "code": code_line,
        "raw": raw,
    }


def run_subprocess(command: list[str], cwd: str, language: str, timeout: int = 10) -> dict:
    try:
        r = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=os.environ.copy(),
        )
        result = {
            "ok": r.returncode == 0,
            "exit_code": r.returncode,
            "stdout": r.stdout,
            "stderr": r.stderr,
            "language": language,
        }
        if r.returncode != 0:
            result["diagnostic"] = parse_error(r.stderr, language)
        return result
    except FileNotFoundError:
        tool = command[0]
        message = f"Required runtime/compiler '{tool}' was not found in PATH."
        return {
            "ok": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": message,
            "language": language,
            "diagnostic": {
                "type": "ToolchainError",
                "message": message,
                "file": "main",
                "line": None,
                "column": None,
                "code": "",
                "raw": message,
            },
        }
    except subprocess.TimeoutExpired as e:
        message = f"Execution timed out after {timeout} seconds."
        return {
            "ok": False,
            "exit_code": -1,
            "stdout": e.stdout or "",
            "stderr": message,
            "language": language,
            "diagnostic": {
                "type": "TimeoutError",
                "message": message,
                "file": "main",
                "line": None,
                "column": None,
                "code": "",
                "raw": message,
            },
        }


def run_code(code: str, language: str) -> dict:
    lang = language.lower().strip()
    aliases = {"py": "python", "js": "javascript", "c++": "cpp"}
    lang = aliases.get(lang, lang)
    if lang not in {"python", "javascript", "c", "cpp", "java"}:
        return {
            "ok": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"{language} execution is not supported in this version.",
            "language": lang,
            "diagnostic": {
                "type": "UnsupportedLanguageError",
                "message": f"{language} execution is not supported in this version.",
                "file": "main",
                "line": None,
                "column": None,
                "code": "",
                "raw": f"{language} execution is not supported in this version.",
            },
        }

    with tempfile.TemporaryDirectory() as td:
        if lang == "python":
            path = Path(td) / "main.py"
            path.write_text(code, encoding="utf-8")
            result = run_subprocess([sys.executable, str(path)], td, lang)
            if not result["ok"]:
                result["diagnostic"] = parse_error(result["stderr"], lang)
            return result

        if lang == "javascript":
            path = Path(td) / "main.js"
            path.write_text(code, encoding="utf-8")
            result = run_subprocess(["node", str(path)], td, lang)
            if not result["ok"]:
                result["diagnostic"] = parse_error(result["stderr"], lang)
            return result

        if lang in {"c", "cpp"}:
            ext = ".c" if lang == "c" else ".cpp"
            compiler = "gcc" if lang == "c" else "g++"
            source = Path(td) / f"main{ext}"
            executable = Path(td) / ("program.exe" if os.name == "nt" else "program")
            source.write_text(code, encoding="utf-8")
            if not shutil.which(compiler):
                message = f"{compiler} is not installed or not available in PATH."
                return {
                    "ok": False,
                    "exit_code": -1,
                    "stdout": "",
                    "stderr": message,
                    "language": lang,
                    "diagnostic": {"type": "ToolchainError", "message": message, "file": source.name, "line": None, "column": None, "code": "", "raw": message},
                }
            compile_result = run_subprocess([compiler, str(source), "-o", str(executable)], td, lang)
            if not compile_result["ok"]:
                compile_result["diagnostic"] = parse_error(compile_result["stderr"], lang)
                compile_result["diagnostic"]["file"] = source.name
                return compile_result
            return run_subprocess([str(executable)], td, lang)

        # Java
        source = Path(td) / "Main.java"
        source.write_text(code, encoding="utf-8")
        if not shutil.which("javac") or not shutil.which("java"):
            message = "Java (javac/java) is not installed or not available in PATH."
            return {
                "ok": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": message,
                "language": lang,
                "diagnostic": {"type": "ToolchainError", "message": message, "file": "Main.java", "line": None, "column": None, "code": "", "raw": message},
            }
        compile_result = run_subprocess(["javac", str(source)], td, lang)
        if not compile_result["ok"]:
            compile_result["diagnostic"] = parse_error(compile_result["stderr"], lang)
            compile_result["diagnostic"]["file"] = "Main.java"
            return compile_result
        return run_subprocess(["java", "-cp", td, "Main"], td, lang)


def ollama_chat(message: str, code: str = "", selection: str = "", system: Optional[str] = None) -> str:
    parts = [message]
    if code:
        parts.append(f"CURRENT EDITOR CODE:\n```\n{code}\n```")
    if selection:
        parts.append(f"SELECTED CODE FROM EDITOR:\n```\n{selection}\n```")
    payload = {
        "model": MODEL,
        "messages": [
            {
                "role": "system",
                "content": system or (
                    "You are LocalMind Code Agent, a local coding assistant. "
                    "Give practical, readable answers. Use Markdown for headings, lists, "
                    "inline code, and fenced code blocks. Inspect supplied code for bugs "
                    "and fixes. Never claim internet access. When selected code is supplied, "
                    "focus on it first."
                ),
            },
            {"role": "user", "content": "\n\n".join(parts)},
        ],
        "stream": False,
        "think": False,
        "options": {"temperature": 0.25},
    }
    x = requests.post(f"{OLLAMA}/api/chat", json=payload, timeout=600)
    x.raise_for_status()
    return x.json().get("message", {}).get("content", "")


@app.get("/")
def home():
    return FileResponse(DIST / "index.html")


@app.get("/api/health")
def health():
    try:
        d = requests.get(f"{OLLAMA}/api/tags", timeout=5).json()
        names = [m.get("name", "") for m in d.get("models", [])]
        return {"backend": True, "ollama": True, "model": MODEL, "model_available": MODEL in names}
    except Exception:
        return {"backend": True, "ollama": False, "model": MODEL, "model_available": False}


@app.post("/api/run")
def run(r: Run):
    return run_code(r.code, r.language)


@app.post("/api/chat")
def chat(r: Chat):
    try:
        return {"ok": True, "response": ollama_chat(r.message, r.code, r.selection)}
    except requests.exceptions.ConnectionError:
        return {"ok": False, "error": "Ollama is not running. Start Ollama or run 'ollama serve'."}
    except requests.exceptions.Timeout:
        return {"ok": False, "error": "Qwen3 8B took too long to answer. Try a shorter request."}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/fix")
def fix(r: FixRequest):
    system = (
        "You are LocalMind Fix Agent. Return a corrected COMPLETE version of the supplied file. "
        "Preserve the user's intended behavior and change only what is needed to fix the reported error. "
        "Your response MUST contain exactly one fenced code block containing the full corrected file, "
        "followed by a short explanation. Do not omit unchanged lines."
    )
    prompt = (
        f"Fix the {r.language} code below.\n\nERROR:\n{r.error}\n\nCODE:\n{r.code}\n\n"
        "Return the full corrected file in one fenced code block."
    )
    try:
        response = ollama_chat(prompt, system=system)
        match = re.search(r"```(?:[\w+#.-]+)?\s*\n(.*?)```", response, re.DOTALL)
        fixed = match.group(1).strip("\n") if match else ""
        if not fixed:
            return {"ok": False, "error": "AI returned no complete code block.", "response": response}
        explanation = response.replace(match.group(0), "").strip()
        return {"ok": True, "fixed_code": fixed, "explanation": explanation, "response": response}
    except requests.exceptions.ConnectionError:
        return {"ok": False, "error": "Ollama is not running."}
    except requests.exceptions.Timeout:
        return {"ok": False, "error": "Qwen3 8B took too long to generate a fix. Try a shorter file or request."}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/project/files")
def project_files():
    files = []
    for root, dirs, filenames in os.walk(BASE):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]
        root_path = Path(root)
        for name in filenames:
            p = root_path / name
            rel = p.relative_to(BASE).as_posix()
            if p.stat().st_size <= 800_000:
                files.append({"path": rel, "size": p.stat().st_size})
    files.sort(key=lambda x: x["path"].lower())
    return {"files": files}


@app.get("/api/project/file")
def project_file(path: str):
    p = safe_project_path(path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="File not found.")
    try:
        return {"path": p.relative_to(BASE).as_posix(), "content": p.read_text(encoding="utf-8")}
    except UnicodeDecodeError:
        raise HTTPException(status_code=415, detail="This file is not a UTF-8 text file.")


@app.put("/api/project/file")
def save_project_file(r: FileWrite):
    p = safe_project_path(r.path)
    if p.suffix.lower() in {".exe", ".dll", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf"}:
        raise HTTPException(status_code=415, detail="Binary files are not editable here.")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(r.content, encoding="utf-8")
    return {"ok": True, "path": p.relative_to(BASE).as_posix()}


@app.post("/api/terminal")
def terminal(r: TerminalCommand):
    if not r.command.strip():
        return {"ok": False, "stdout": "", "stderr": "Empty command."}
    if os.name == "nt":
        command = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", r.command]
    else:
        command = ["bash", "-lc", r.command]
    try:
        proc = subprocess.run(command, cwd=BASE, capture_output=True, text=True, timeout=30, env=os.environ.copy())
        return {"ok": proc.returncode == 0, "exit_code": proc.returncode, "stdout": proc.stdout, "stderr": proc.stderr}
    except subprocess.TimeoutExpired:
        return {"ok": False, "exit_code": -1, "stdout": "", "stderr": "Terminal command timed out after 30 seconds."}
    except Exception as e:
        return {"ok": False, "exit_code": -1, "stdout": "", "stderr": str(e)}


@app.get("/{path:path}")
def static(path: str):
    p = DIST / path
    return FileResponse(p if p.is_file() else DIST / "index.html")
