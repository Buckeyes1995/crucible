"""Abstract base adapter."""

from abc import ABC, abstractmethod
from typing import AsyncGenerator

from models.schemas import ModelEntry, ChatMessage


class BaseAdapter(ABC):
    """Common interface for all inference backends."""

    @abstractmethod
    async def load(self, model: ModelEntry) -> AsyncGenerator[dict, None]:
        """Load a model. Yields SSE-style dicts with event/data keys."""
        ...

    @abstractmethod
    async def stop(self) -> None:
        """Stop the running model/server."""
        ...

    @abstractmethod
    async def chat(
        self,
        messages: list[ChatMessage],
        temperature: float,
        max_tokens: int,
    ) -> AsyncGenerator[dict, None]:
        """Stream chat completion. Yields token dicts."""
        ...

    @abstractmethod
    def is_loaded(self) -> bool:
        """Return True if a model is currently loaded and ready."""
        ...

    @property
    @abstractmethod
    def model_id(self) -> str | None:
        """Return the currently loaded model ID, or None."""

    last_tps: float | None = None
    """Last measured generation tokens per second."""

    last_prompt_tps: float | None = None
    """Last measured prompt eval tokens per second."""

    last_ttft_ms: float | None = None
    """Last measured time to first token in milliseconds."""
