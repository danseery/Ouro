"""Ouro Web — minimal Flask dev server for local development.

Serves the static game assets at http://localhost:5000/.
The game engine runs entirely in the browser (engine.js + game.js).

For production, deploy the build/ folder to Azure Static Web Apps instead.
"""

from __future__ import annotations

from pathlib import Path

from flask import Flask, send_from_directory

_STATIC = Path(__file__).parent / "static"

app = Flask(__name__, static_folder=str(_STATIC), static_url_path="")
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0


@app.route("/")
def index():
    return send_from_directory(str(_STATIC), "index.html")


def run_server(host: str = "127.0.0.1", port: int = 5000, debug: bool = False) -> None:
    app.run(host=host, port=port, debug=debug)
