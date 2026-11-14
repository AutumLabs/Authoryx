"""Start the repository's stand-in agent API (test/fake-agent-api) for the Python tests."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]


class Fake:
    def __init__(self, info: dict) -> None:
        self.url = info["url"]
        self.agent_id = info["agentId"]
        self.agent_key = info["agentKey"]

    def control(self, action: str, **body):
        req = urllib.request.Request(
            f"{self.url}/_control/{action}", data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())["result"]


@pytest.fixture(scope="session")
def fake():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is needed for the stand-in API")
    p = subprocess.Popen(
        [node, "--import", "tsx", "test/fake-agent-api/bin.ts", "--control"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        text=True,
        env={**os.environ},
    )
    line = p.stdout.readline()
    try:
        yield Fake(json.loads(line))
    finally:
        p.terminate()
        p.wait(timeout=10)
