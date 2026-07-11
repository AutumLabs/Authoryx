"""FastAPI application factory for the AuthoryxOS backend."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .api import admin, health, os_routes
from .api.errors import ProtocolError, protocol_error_handler
from .core.config import settings
from .core.db import create_all

log = logging.getLogger("authoryx")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Dev/test convenience: ensure tables exist without a migration step.
    # Production uses Alembic (see migrations/), so skip auto-create there.
    if settings.env != "prod":
        create_all()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="AuthoryxOS",
        version=__version__,
        description="Identity delegation and secret access engine for agentic AI.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Protocol error envelope.
    app.add_exception_handler(ProtocolError, protocol_error_handler)

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(_req: Request, exc: RequestValidationError) -> JSONResponse:
        msg = exc.errors()[0]["msg"] if exc.errors() else "Invalid request body."
        return ProtocolError("invalid_intent", f"Schema error: {msg}").to_response()

    # Routers.
    app.include_router(health.router)
    app.include_router(os_routes.router)
    app.include_router(admin.router)
    if settings.dashboard_enabled:
        from .dashboard import routes as dashboard_routes

        app.include_router(dashboard_routes.router)

    return app


app = create_app()
