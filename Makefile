# AuthoryxOS developer & operator commands.
.PHONY: help setup up down logs seed migrate test conformance dev-backend

help:
	@echo "AuthoryxOS make targets:"
	@echo "  setup        One-shot: generate secrets, build, start, migrate, print admin key"
	@echo "  up / down    Start / stop the docker-compose stack"
	@echo "  logs         Tail backend logs"
	@echo "  seed         Mint an admin API key (and ensure demo data)"
	@echo "  migrate      Apply database migrations in the running backend"
	@echo "  dev-backend  Run the backend locally on SQLite (no Docker)"
	@echo "  test         Run unit/integration tests (backend, cli, sdk)"
	@echo "  conformance  Run the protocol conformance suite against AUTHORYXOS_BASE_URL"

setup:
	./scripts/bootstrap.sh

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f backend

seed:
	docker compose exec -T backend authoryx-backend seed

migrate:
	docker compose exec -T backend alembic upgrade head

dev-backend:
	cd apps/backend && pip install -e ".[dev]" && authoryx-backend seed && authoryx-backend serve --reload

test:
	cd apps/backend && python -m pytest -q
	cd apps/cli && python -m pytest -q
	cd packages/sdk-python && python -m pytest -q

# Requires a running backend and an admin key:
#   AUTHORYXOS_BASE_URL=http://localhost:8787 AUTHORYXOS_ADMIN_KEY=axos_live_… make conformance
conformance:
	cd tests/conformance && python -m pytest -q
