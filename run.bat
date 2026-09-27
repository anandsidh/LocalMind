@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo.
    echo Python virtual environment not found.
    echo Create it with:
    echo   python -m venv .venv
    echo   .venv\Scripts\activate
    echo   pip install -r backend\requirements.txt
    echo.
    pause
    exit /b 1
)

echo Starting LocalMind...
echo.
echo Make sure Ollama is installed and Qwen3 8B is available.
echo If Ollama is not running, open another terminal and run:
echo   ollama serve
echo.
start "LocalMind Server" cmd /k ""%~dp0.venv\Scripts\python.exe" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8000"
