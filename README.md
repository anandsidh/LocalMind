# LocalMind — Offline AI Website

A complete local AI website using:

- FastAPI
- Ollama
- Qwen3 8B
- HTML/CSS/JavaScript
- Python 3.12

No OpenAI API key is required.

## Folder structure

```text
AIAGENT/
├── backend/
│   ├── __init__.py
│   ├── main.py
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── .gitignore
├── run.bat
└── README.md
```

## 1. Open the project

In VS Code, open this folder:

```text
E:\AIAGENT
```

## 2. Create virtual environment

Open VS Code terminal:

```powershell
python -m venv .venv
```

Activate it:

```powershell
.\.venv\Scripts\Activate.ps1
```

## 3. Install backend packages

```powershell
pip install -r backend\requirements.txt
```

## 4. Check Ollama

```powershell
ollama --version
ollama list
```

You should have:

```text
qwen3:8b
```

If Ollama is not running:

```powershell
ollama serve
```

## 5. Start the website

With the virtual environment active:

```powershell
uvicorn backend.main:app --reload
```

Open:

```text
http://127.0.0.1:8000
```

## 6. Optional one-click start

Double-click:

```text
run.bat
```

## How the connection works

```text
Browser
   ↓
FastAPI (127.0.0.1:8000)
   ↓
Ollama (127.0.0.1:11434)
   ↓
Qwen3 8B
```

The browser talks only to your local FastAPI server. FastAPI talks to the local Ollama server.

## Offline test

After setup is complete:

1. Turn off Wi-Fi.
2. Start Ollama.
3. Start the FastAPI server.
4. Open `http://127.0.0.1:8000`.
5. Ask a question.

If the model answers with Wi-Fi disabled, your local inference is working offline.

## Notes for this laptop

This project is designed to start with Qwen3 8B on a 16 GB RAM CPU-oriented laptop. Local CPU inference will be slower than a cloud GPU service. That is expected.

## Next upgrade

After the base chatbot is stable, add:

1. Local PDF/document RAG.
2. Local file tools.
3. SQLite conversation memory.
4. Agent tool calling.
