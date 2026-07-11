"""A string-like wrapper that refuses to render itself in logs or reprs."""

from __future__ import annotations


class SecretStr:
    """Holds a secret without exposing it through `repr`, `str`, or `format`.

    Call `.reveal()` explicitly when the raw value is required.
    """

    __slots__ = ("_value",)

    def __init__(self, value: str) -> None:
        if not isinstance(value, str):
            raise TypeError("SecretStr requires a str")
        self._value = value

    def reveal(self) -> str:
        return self._value

    def __repr__(self) -> str:
        return "SecretStr(***)"

    def __str__(self) -> str:
        return "***"

    def __format__(self, _spec: str) -> str:
        return "***"

    def __eq__(self, other: object) -> bool:
        if isinstance(other, SecretStr):
            return self._value == other._value
        return NotImplemented

    def __hash__(self) -> int:
        return hash(("authoryxos.SecretStr", self._value))

    def zero(self) -> None:
        """Best-effort clear. Python strings are immutable, so this just
        drops the reference — the GC will reclaim the buffer."""
        self._value = ""
