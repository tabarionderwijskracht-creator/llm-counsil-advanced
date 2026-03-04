@echo off
echo Starting LLM Council...
echo.

echo Starting backend on http://localhost:8001...
start "LLM Council Backend" cmd /k "cd /d %~dp0 && python -m backend.main"

timeout /t 2 /nobreak >nul

echo Starting frontend on http://localhost:5173...
start "LLM Council Frontend" cmd /k "cd /d %~dp0frontend && npm run dev -- --host"

echo.
echo LLM Council is running!
echo   Backend:  http://localhost:8001
echo   Frontend: http://localhost:5173
echo.
echo Close the terminal windows to stop the servers.
