"""
Tests for services/off_api.py's rate-limit-aware search path
(_fetch_off/_search_products_impl/search_products_with_status). requests.get
and the on-disk cache are stubbed so these never touch the network or the
real committed _off_cache.json.
"""

import requests

from backend.app.services import off_api


class _FakeResponse:
    def __init__(self, status_code, json_data=None):
        self.status_code = status_code
        self._json_data = json_data or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(f"status {self.status_code}")

    def json(self):
        return self._json_data


def _stub_cache(monkeypatch):
    """In-memory replacement for the on-disk JSON cache, isolated per test."""

    store: dict = {}
    monkeypatch.setattr(off_api, "_load_cache", lambda: dict(store))

    def fake_save(cache):
        store.clear()
        store.update(cache)

    monkeypatch.setattr(off_api, "_save_cache", fake_save)
    return store


def test_fetch_off_reports_rate_limited_after_persistent_429(monkeypatch):
    monkeypatch.setattr(off_api.time, "sleep", lambda *_: None)
    monkeypatch.setattr(off_api.requests, "get", lambda *a, **k: _FakeResponse(429))

    products, rate_limited = off_api._fetch_off("test query", 5, max_retries=2)
    assert products == []
    assert rate_limited is True


def test_fetch_off_returns_products_and_not_rate_limited_on_success(monkeypatch):
    monkeypatch.setattr(
        off_api.requests,
        "get",
        lambda *a, **k: _FakeResponse(200, {"hits": [{"code": "1"}]}),
    )

    products, rate_limited = off_api._fetch_off("test query", 5)
    assert products == [{"code": "1"}]
    assert rate_limited is False


def test_search_products_with_status_never_caches_a_rate_limited_outcome(monkeypatch):
    cache = _stub_cache(monkeypatch)
    monkeypatch.setattr(off_api.time, "sleep", lambda *_: None)
    monkeypatch.setattr(off_api.requests, "get", lambda *a, **k: _FakeResponse(429))

    products, rate_limited = off_api.search_products_with_status("rate limited query", page_size=5)
    assert products == []
    assert rate_limited is True
    # A rate-limited outcome must never be frozen into the cache as a false
    # "confirmed no results" -- the next call should retry live.
    assert cache == {}


def test_search_products_falls_back_to_unfiltered_when_store_scoped_is_empty(monkeypatch):
    _stub_cache(monkeypatch)
    calls = []

    def fake_get(url, params=None, headers=None, timeout=None):
        scoped = "stores_tags:" in params.get("q", "")
        calls.append(scoped)
        if scoped:
            return _FakeResponse(200, {"hits": []})
        return _FakeResponse(200, {"hits": [{"code": "42"}]})

    monkeypatch.setattr(off_api.requests, "get", fake_get)

    products, rate_limited = off_api.search_products_with_status(
        "store scoped query", page_size=5, store="Rewe"
    )
    assert products == [{"code": "42"}]
    assert rate_limited is False
    assert calls == [True, False]


def test_search_products_skips_the_unfiltered_fallback_when_rate_limited(monkeypatch):
    _stub_cache(monkeypatch)
    monkeypatch.setattr(off_api.time, "sleep", lambda *_: None)
    calls = []

    def fake_get(url, params=None, headers=None, timeout=None):
        calls.append("stores_tags:" in params.get("q", ""))
        return _FakeResponse(429)

    monkeypatch.setattr(off_api.requests, "get", fake_get)

    products, rate_limited = off_api.search_products_with_status(
        "store scoped rate limited query", page_size=5, store="Rewe"
    )
    assert products == []
    assert rate_limited is True
    # Every attempt was still store-scoped -- the unfiltered fallback was
    # never tried, since it would just spend more retries on the same limit.
    assert all(calls)


def test_search_products_discards_the_rate_limited_flag(monkeypatch):
    """search_products (used by the automatic resolver) keeps its existing
    contract -- never raises, just returns []."""

    monkeypatch.setattr(off_api.time, "sleep", lambda *_: None)
    monkeypatch.setattr(off_api.requests, "get", lambda *a, **k: _FakeResponse(429))
    _stub_cache(monkeypatch)

    assert off_api.search_products("plain resolver query", page_size=5) == []
