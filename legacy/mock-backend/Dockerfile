FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml /app/
COPY authoryxos_mock /app/authoryxos_mock
COPY templates /app/templates
RUN pip install --no-cache-dir .
EXPOSE 8787
CMD ["uvicorn", "authoryxos_mock.main:app", "--host", "0.0.0.0", "--port", "8787"]
