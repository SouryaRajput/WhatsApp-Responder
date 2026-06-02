"""
[EC-01] Per-phone async mutex to prevent concurrent message processing
for the same user. Also handles lock cleanup to prevent memory leaks.
"""

import asyncio
import time
import logging
from app.config import settings

logger = logging.getLogger(__name__)


class LockManager:
    def __init__(self):
        self._locks: dict[str, asyncio.Lock] = {}
        self._timestamps: dict[str, float] = {}
        self._cleanup_lock = asyncio.Lock()

    async def acquire(self, phone: str) -> asyncio.Lock:
        async with self._cleanup_lock:
            if phone not in self._locks:
                self._locks[phone] = asyncio.Lock()
                self._timestamps[phone] = time.time()
            lock = self._locks[phone]
            self._timestamps[phone] = time.time()

        await lock.acquire()
        return lock

    def release(self, phone: str, lock: asyncio.Lock):
        lock.release()

    async def cleanup_stale(self):
        """[EC-24] Remove locks not used in LOCK_TTL_SECONDS."""
        async with self._cleanup_lock:
            now = time.time()
            stale = [
                p for p, ts in self._timestamps.items()
                if now - ts > settings.LOCK_TTL_SECONDS
                and not self._locks[p].locked()
            ]
            for p in stale:
                del self._locks[p]
                del self._timestamps[p]
            if stale:
                logger.info(f"Cleaned up {len(stale)} stale locks")


lock_manager = LockManager()