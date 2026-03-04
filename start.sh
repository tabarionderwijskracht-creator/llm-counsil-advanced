#!/bin/bash

# LLM Council - Start script

echo "Starting LLM Council..."
echo ""

# Start backend
echo "Starting backend on http://0.0.0.0:8001..."
uv run python -m backend.main &
BACKEND_PID=$!

# Wait a bit for backend to start
sleep 2

# Start frontend
echo "Starting frontend on http://0.0.0.0:5173..."
cd frontend
npm run dev -- --host &
FRONTEND_PID=$!

echo ""
echo "✓ LLM Council is running!"
echo "  Backend:  http://192.168.50.177:8001"
echo "  Frontend: http://192.168.50.177:5173"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
