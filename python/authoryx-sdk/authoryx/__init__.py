"""Python client for the Authoryx agent API."""

from ._version import VERSION
from .client import AGENT_API_PATH, SUPPORTED_API_VERSIONS, Authoryx
from .errors import AuthoryxError

__all__ = ["Authoryx", "AuthoryxError", "VERSION", "SUPPORTED_API_VERSIONS", "AGENT_API_PATH"]
__version__ = VERSION
