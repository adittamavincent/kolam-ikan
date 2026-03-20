from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator


@dataclass
class PageProgress:
    total_pages: int
    completed_pages: int = 0
    stage: str = "initializing"
    started_at: float = field(default_factory=time.monotonic)
    page_durations: list[float] = field(default_factory=list)
    _last_tick_at: float | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def tick(self, completed: int | None = None, total: int | None = None) -> None:
        with self._lock:
            now = time.monotonic()
            if self._last_tick_at is not None:
                duration = now - (self._last_tick_at or 0.0) # type: ignore
                if duration > 0:
                    self.page_durations.append(duration)
            self._last_tick_at = now

            if total is not None and total > 0:
                self.total_pages = total

            if completed is None:
                self.completed_pages += 1
            else:
                self.completed_pages = max(0, completed)

            if self.total_pages > 0:
                self.completed_pages = min(self.completed_pages, self.total_pages)

    @property
    def percent(self) -> int:
        if self.total_pages <= 0:
            return 0
        return min(99, int((self.completed_pages / self.total_pages) * 100))

    @property
    def eta_seconds(self) -> int | None:
        if self.total_pages <= 0 or self.completed_pages <= 0 or not self.page_durations:
            return None
        remaining = max(0, self.total_pages - self.completed_pages)
        if remaining == 0:
            return 0
        recent = self.page_durations[-5:] # type: ignore
        avg_per_page = sum(recent) / len(recent)
        return max(1, math.ceil(avg_per_page * remaining))

    @property
    def message(self) -> str:
        eta = self.eta_seconds
        eta_str = f" (~{eta}s remaining)" if eta else ""
        return f"{self.stage}: page {self.completed_pages}/{self.total_pages}{eta_str}"


class ProgressTqdm:
    def __init__(
        self,
        iterable: Any = None,
        *args: Any,
        on_tick: Callable[[int, int], None] | None = None,
        **kwargs: Any,
    ) -> None:
        self._iterable = iterable
        self._on_tick = on_tick
        self._total = kwargs.get("total") or (
            len(iterable) if hasattr(iterable, "__len__") else 0
        )
        self._n = 0

    def __iter__(self) -> Iterator[Any]:
        for item in (self._iterable or []):
            yield item
            self._n += 1
            if self._on_tick:
                try:
                    self._on_tick(self._n, self._total) # type: ignore
                except Exception:
                    pass

    def update(self, n: int = 1) -> None:
        self._n += n
        if self._on_tick:
            try:
                self._on_tick(self._n, self._total) # type: ignore
            except Exception:
                pass

    def set_postfix(self, *args: Any, **kwargs: Any) -> None:
        pass

    def set_description(self, *args: Any, **kwargs: Any) -> None:
        pass

    def close(self) -> None:
        pass

    def __enter__(self) -> "ProgressTqdm":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


class DoclingProgressInterceptor:
    def __init__(self, tracker: PageProgress) -> None:
        self._tracker = tracker
        self._original_tqdm: Any = None
        self._original_trange: Any = None
        self._submodule_originals: dict[str, Any] = {}

    def _make_tqdm(self) -> type:
        tracker = self._tracker

        class _PatchedTqdm(ProgressTqdm):
            def __init__(self, iterable: Any = None, *args: Any, **kwargs: Any) -> None:
                super().__init__(
                    iterable,
                    *args,
                    on_tick=lambda n, total: tracker.tick(
                        completed=n,
                        total=total if total > 0 else None,
                    ),
                    **kwargs,
                )

        return _PatchedTqdm

    def __enter__(self) -> "DoclingProgressInterceptor":
        import sys
        import tqdm as tqdm_module # type: ignore

        self._original_tqdm = tqdm_module.tqdm
        self._original_trange = getattr(tqdm_module, "trange", None)

        patched = self._make_tqdm()
        tqdm_module.tqdm = patched
        if self._original_trange is not None:
            tqdm_module.trange = lambda *a, **kw: patched(range(*a), **kw)

        for mod_name, mod in list(sys.modules.items()):
            if mod_name.startswith("docling") and hasattr(mod, "tqdm"):
                self._submodule_originals[mod_name] = getattr(mod, "tqdm")
                setattr(mod, "tqdm", patched)

        return self

    def __exit__(self, *args: Any) -> None:
        import sys
        import tqdm as tqdm_module # type: ignore

        if self._original_tqdm is not None:
            tqdm_module.tqdm = self._original_tqdm
        if self._original_trange is not None:
            tqdm_module.trange = self._original_trange

        for mod_name, original in self._submodule_originals.items():
            mod = sys.modules.get(mod_name)
            if mod is not None:
                setattr(mod, "tqdm", original)