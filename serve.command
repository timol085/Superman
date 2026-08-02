#!/bin/bash
# Double-click to launch the Superman app with a local server.
cd "$(dirname "$0")" || exit 1
echo "Serving Superman at http://localhost:8000  (press Ctrl+C to stop)"
( sleep 1; open "http://localhost:8000" ) &
python3 -m http.server 8000
