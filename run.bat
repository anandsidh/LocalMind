@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (echo Create .venv first & pause & exit /b 1)
if not exist "frontend\dist\index.html" (echo Run: cd frontend ^&^& npm install ^&^& npm run build & pause & exit /b 1)
start "LocalMind" cmd /k ".venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8000"
