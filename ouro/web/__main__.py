"""Entry point for the web version: python -m ouro.web"""

import argparse

from ouro.web.server import run_server


def main() -> None:
    parser = argparse.ArgumentParser(description="Ouro — Web Version")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=5000, help="Port (default: 5000)")
    parser.add_argument("--debug", action="store_true", help="Enable Flask debug mode")
    args = parser.parse_args()

    print(f"\n  🐍 Ouro — The Eternal Serpent (Web Edition)")
    print(f"  ➜ http://{args.host}:{args.port}/\n")

    run_server(host=args.host, port=args.port, debug=args.debug)


if __name__ == "__main__":
    main()
