"""Envelope encryption for secrets at rest.

Each secret value is encrypted with a freshly generated 256-bit
data-encryption key (DEK) using AES-256-GCM. The DEK is then itself
encrypted ("wrapped") with the long-lived master key (also AES-256-GCM).
The backend persists only:

    ciphertext, nonce, wrapped_dek, dek_nonce

The plaintext secret exists in memory only transiently, while serving an
approved fetch. Rotating the master key requires only re-wrapping DEKs,
not re-encrypting every secret.

The master key never leaves the process and is never written to the DB.
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import settings

_KEY_LEN = 32  # 256-bit
_NONCE_LEN = 12  # 96-bit, recommended for GCM


def _b64e(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _b64d(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def _master_key() -> bytes:
    raw = bytes.fromhex(settings.master_key)
    if len(raw) != _KEY_LEN:
        raise ValueError(
            f"AUTHORYX_MASTER_KEY must be {_KEY_LEN} bytes ({_KEY_LEN * 2} hex chars); "
            f"got {len(raw)} bytes."
        )
    return raw


@dataclass(frozen=True)
class SealedSecret:
    """The four ciphertext components persisted for one secret."""

    ciphertext: str  # base64
    nonce: str  # base64
    wrapped_dek: str  # base64
    dek_nonce: str  # base64


def seal(plaintext: str) -> SealedSecret:
    """Encrypt ``plaintext`` under a new DEK, then wrap the DEK with the master key."""
    dek = AESGCM.generate_key(bit_length=256)
    data_nonce = os.urandom(_NONCE_LEN)
    ciphertext = AESGCM(dek).encrypt(data_nonce, plaintext.encode("utf-8"), None)

    dek_nonce = os.urandom(_NONCE_LEN)
    wrapped = AESGCM(_master_key()).encrypt(dek_nonce, dek, None)

    return SealedSecret(
        ciphertext=_b64e(ciphertext),
        nonce=_b64e(data_nonce),
        wrapped_dek=_b64e(wrapped),
        dek_nonce=_b64e(dek_nonce),
    )


def open_secret(sealed: SealedSecret) -> str:
    """Unwrap the DEK with the master key, then decrypt the ciphertext.

    Raises ``cryptography.exceptions.InvalidTag`` if the master key is wrong
    or any component was tampered with.
    """
    dek = AESGCM(_master_key()).decrypt(
        _b64d(sealed.dek_nonce), _b64d(sealed.wrapped_dek), None
    )
    plaintext = AESGCM(dek).decrypt(_b64d(sealed.nonce), _b64d(sealed.ciphertext), None)
    return plaintext.decode("utf-8")
