#!/usr/bin/env bash
# Studio CAD — dev launcher.
#   ./run.sh            # uses the active env, or creates ./venv from requirements.txt
#   PORT=8080 ./run.sh  # choose a port
set -e
cd "$(dirname "$0")"

if python -c "import cadquery" >/dev/null 2>&1; then
    PY="python"                      # an environment with CadQuery is already active (conda/venv)
elif [ -x "venv/bin/python" ]; then
    PY="venv/bin/python"
else
    echo "No CadQuery found — creating ./venv (conda is more reliable; see README)…"
    python3 -m venv venv
    PY="venv/bin/python"
    "$PY" -m pip install -q --upgrade pip
    "$PY" -m pip install -q -r requirements.txt
fi

echo "=================================================="
echo "  Studio CAD  →  http://localhost:${PORT:-5001}"
echo "=================================================="
exec "$PY" server.py
