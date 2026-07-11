FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY pyproject.toml alembic.ini docker-entrypoint.sh /app/
COPY authoryx /app/authoryx
RUN pip install --no-cache-dir ".[postgres]" && chmod +x /app/docker-entrypoint.sh

EXPOSE 8787
ENTRYPOINT ["/app/docker-entrypoint.sh"]
