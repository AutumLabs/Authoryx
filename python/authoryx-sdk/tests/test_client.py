"""The Python SDK against the stand-in API: every call and every error kind (FR-014, AC-038)."""

from __future__ import annotations

import threading
import time

import pytest

from authoryx import VERSION, Authoryx, AuthoryxError


@pytest.fixture()
def ax(fake):
    fake.control("autoApprove", value=False)
    fake.control("off", value=False)
    fake.control("apiVersion", value=1)
    return Authoryx(fake.agent_id, fake.agent_key, fake.url)


def circle_id(ax):
    return next(c["id"] for c in ax.circles() if c["name"] == "Deploy")


def refused(fn, kind, **attrs):
    with pytest.raises(AuthoryxError) as e:
        fn()
    assert e.value.kind == kind, e.value.message
    for k, v in attrs.items():
        assert getattr(e.value, k) == v
    return e.value


def test_whoami_and_listings(ax, fake):
    me = ax.whoami()
    assert me["agent"]["id"] == fake.agent_id and me["apiVersion"] == 1
    cid = circle_id(ax)
    s = ax.secrets(cid)
    assert [x["keyName"] for x in s["secrets"]] == ["API_TOKEN", "GH_LOGIN", "OTP", "NOTE"]
    assert s["vaults"][0]["name"] == "CI"
    assert s["secrets"][0]["access"]["state"] == "ask"


def test_request_wait_fetch_close(ax, fake):
    cid = circle_id(ax)
    r = ax.request(cid, ["API_TOKEN", "GH_LOGIN", "OTP", "NOTE"], "python", hint="once")
    assert r["state"] == "pending" and r["approvalUrl"].endswith(r["id"])
    threading.Timer(0.1, lambda: fake.control("approve", id=r["id"])).start()
    t = time.monotonic()
    r = ax.wait_for_request(r["id"], seconds=5, interval=0.02)
    assert r["state"] == "approved" and time.monotonic() - t < 3
    secrets = {s["keyName"]: s for s in fake.control("circles")[0]["secrets"]}
    tok = ax.fetch(r["id"], "API_TOKEN")
    assert tok["type"] == "api_key" and tok["value"] == secrets["API_TOKEN"]["value"]
    login = ax.fetch(r["id"], "GH_LOGIN")
    assert login["password"] == secrets["GH_LOGIN"]["value"] and login["username"] == "release-bot"
    assert ax.fetch(r["id"], "OTP")["code"] == secrets["OTP"]["value"]
    assert ax.close_request(r["id"], "done")["state"] == "closed"
    refused(lambda: ax.fetch(r["id"], "API_TOKEN"), "not_approved", state="closed", status=403)


def test_wait_ends_while_pending(ax):
    r = ax.request(circle_id(ax), ["NOTE"], "wait out")
    assert ax.wait_for_request(r["id"], seconds=0.1, interval=0.02)["state"] == "pending"
    ax.close_request(r["id"], "abandoned")


def test_not_approved_states(ax, fake):
    r = ax.request(circle_id(ax), ["API_TOKEN", "NOTE"], "states")
    refused(lambda: ax.fetch(r["id"], "API_TOKEN"), "not_approved", state="pending")
    fake.control("deny", id=r["id"], keyNames=["API_TOKEN"])
    refused(lambda: ax.fetch(r["id"], "API_TOKEN"), "not_approved", state="denied")
    fake.control("approve", id=r["id"], keyNames=["NOTE"])
    fake.control("expireUse", id=r["id"])
    refused(lambda: ax.fetch(r["id"], "NOTE"), "not_approved", state="expired")


def test_error_kinds(ax, fake):
    refused(lambda: Authoryx(fake.agent_id, "axa_" + "x" * 43, fake.url).circles(), "unauthorized", status=401)
    refused(lambda: ax.secrets("00000000-0000-0000-0000-000000000000"), "not_found", status=404)
    refused(lambda: ax.request(circle_id(ax), [], "x"), "invalid", field="keyNames")
    ids = [ax.request(circle_id(ax), ["OTP"], f"p{i}")["id"] for i in range(5)]
    refused(lambda: ax.request(circle_id(ax), ["OTP"], "sixth"), "pending_limit", status=429)
    for i in ids:
        ax.close_request(i, "abandoned")
    fake.control("rateLimit", count=1, reset=5)
    refused(lambda: Authoryx(fake.agent_id, fake.agent_key, fake.url, max_retry_wait_seconds=1).circles(), "rate_limited", retry_after=5)
    fake.control("rateLimit", count=1, reset=1)
    assert len(ax.circles()) == 2  # waited out and retried
    fake.control("off", value=True)
    refused(ax.circles, "api_off", status=503)
    fake.control("off", value=False)
    fake.control("apiVersion", value=2)
    e = refused(ax.whoami, "version_unsupported")
    assert "version 2" in e.message and "supports 1" in e.message
    refused(lambda: Authoryx(fake.agent_id, fake.agent_key, "http://127.0.0.1:9").circles(), "network")


def test_user_agent_and_no_key_in_repr(ax, fake):
    calls = []
    a = Authoryx(fake.agent_id, fake.agent_key, fake.url, on_call=calls.append)
    a.circles()
    assert calls[0]["route"] == "/circles" and calls[0]["status"] == 200
    assert fake.agent_key not in repr(a) and fake.agent_key not in str(vars(a).get("api_url"))
    assert VERSION == "0.1.0"
