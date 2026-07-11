"""Small operational CLI for the backend: ``authoryx-backend <command>``.

Commands:
  initdb   Create tables directly (dev/test; prod uses Alembic).
  seed     Ensure a default tenant + demo secret, mint an admin API key.
  serve    Run uvicorn (thin wrapper for convenience).
"""

from __future__ import annotations

import argparse
import sys


def _cmd_initdb(_args: argparse.Namespace) -> int:
    from .core.db import create_all

    create_all()
    print("Tables created.")
    return 0


def _cmd_seed(args: argparse.Namespace) -> int:
    from .core.db import SessionLocal, create_all
    from .services.seed import seed

    create_all()
    db = SessionLocal()
    try:
        result = seed(db, mint_admin_key=not args.no_key)
    finally:
        db.close()
    print(f"Default tenant: {result.tenant_id}")
    if result.admin_api_key:
        print(f"Admin API key:  {result.admin_api_key}")
        print("Store this now — it is not recoverable.")
    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run("authoryx.main:app", host=args.host, port=args.port, reload=args.reload)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="authoryx-backend")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("initdb", help="Create tables directly.").set_defaults(func=_cmd_initdb)

    s = sub.add_parser("seed", help="Seed tenant + demo secret + admin key.")
    s.add_argument("--no-key", action="store_true", help="Do not mint a new admin key.")
    s.set_defaults(func=_cmd_seed)

    sv = sub.add_parser("serve", help="Run the API with uvicorn.")
    sv.add_argument("--host", default="0.0.0.0")
    sv.add_argument("--port", type=int, default=8787)
    sv.add_argument("--reload", action="store_true")
    sv.set_defaults(func=_cmd_serve)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
