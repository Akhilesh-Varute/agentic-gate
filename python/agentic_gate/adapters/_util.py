from typing import Any


def get(obj: Any, key: str, default: Any = None) -> Any:
    """Reads `key` off `obj` whether it's a plain dict (e.g. boto3 responses)
    or an attribute-style object (e.g. the openai/anthropic/google-genai SDKs'
    Pydantic response models), so adapters work with real SDK responses
    without requiring the caller to pre-convert anything."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def to_plain(obj: Any) -> Any:
    """Converts an SDK response object to a plain dict/primitive suitable for
    appending back into a `messages`/`contents` list, using the object's own
    `model_dump()` if it's a Pydantic model. Dicts and primitives pass through."""
    if isinstance(obj, dict) or obj is None:
        return obj
    if hasattr(obj, "model_dump"):
        return obj.model_dump(exclude_none=True)
    return obj
