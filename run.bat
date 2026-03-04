@echo off
echo Starting Digital Safety Assistant...
echo Access the app at: http://localhost:8000
echo Press Ctrl+C to stop the server
echo.

python -m http.server 8000 || python3 -m http.server 8000
if %ERRORLEVEL% neq 0 (
    echo Error: Python is required to run the local server.
)
pause
