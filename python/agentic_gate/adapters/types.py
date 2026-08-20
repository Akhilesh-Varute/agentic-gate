from dataclasses import dataclass
from typing import Any, List, Optional


@dataclass
class AdapterOutcome:
    # True when the model returned a final answer with no tool calls.
    done: bool
    # Messages/contents to append to your conversation list, in order.
    messages: List[Any]
    # The model's final text, only set when done is True.
    text: Optional[str] = None
