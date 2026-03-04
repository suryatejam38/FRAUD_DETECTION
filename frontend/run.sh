#!/bin/bash
# Script to run the Digital Safety Assistant locally

echo "Starting Digital Safety Assistant..."
echo "Access the app at: http://localhost:8000"
echo "Press Ctrl+C to stop the server"
echo ""

# Check if python3 is available
if command -v python3 &>/dev/null; then
    python3 -m http.server 8000
# Fallback to python
elif command -v python &>/dev/null; then
    python -m http.server 8000
else
    echo "Error: Python is required to run the local server."
    exit 1
fi
