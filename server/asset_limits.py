"""Portable worker budgets without confusing reserved VM with resident memory.

Darwin can reserve more virtual address space at startup than our decode budget.
Its kernel rejects an RLIMIT_AS below that existing reservation. Keep Linux's
hard AS cap; use a peak-RSS watchdog on Darwin, plus independent Unix CPU/file
limits and the caller's mandatory wall-clock/format allocation bounds.
"""
from __future__ import annotations
from dataclasses import dataclass
import os
import sys
import threading
from typing import Callable

MEMORY_BYTES = 1536 * 1024 * 1024
FILE_BYTES = 64 * 1024 * 1024
POLL_SECONDS = 0.05


class WorkerLimitError(ValueError):
    pass


@dataclass
class WorkerBudget:
    report: dict[str, str]
    read_memory: Callable[[], int] | None = None
    stop: threading.Event | None = None
    watcher: threading.Thread | None = None

    def check(self):
        if self.read_memory is not None:
            try:
                used = self.read_memory()
            except Exception:
                raise WorkerLimitError('Worker memory measurement is unavailable.') from None
            if used < 0 or used > MEMORY_BYTES:
                raise WorkerLimitError('Asset decoding exceeded its resident-memory budget.')

    def close(self):
        if self.stop is not None:
            self.stop.set()
        if self.watcher is not None:
            self.watcher.join(timeout=0.5)


def _watch_resident(read_memory, stop, terminate=os._exit):
    while not stop.wait(POLL_SECONDS):
        try:
            used = read_memory()
        except Exception:
            terminate(79)  # Fail closed if a running guard can no longer measure.
            return
        if used < 0 or used > MEMORY_BYTES:
            terminate(78)
            return


def _set_limit(resource, symbol: str, soft: int, hard: int) -> str:
    """Never raise an inherited limit; one unsupported limit cannot skip others."""
    try:
        limit = getattr(resource, symbol)
        old_soft, old_hard = resource.getrlimit(limit)
        if old_hard != resource.RLIM_INFINITY:
            hard = min(hard, old_hard)
        if old_soft != resource.RLIM_INFINITY:
            soft = min(soft, old_soft)
        soft = min(soft, hard)
        resource.setrlimit(limit, (soft, hard))
        return 'enforced'
    except (AttributeError, ValueError, OSError):
        return 'unavailable'


def apply_worker_limits(*, platform=None, resource_module=None) -> WorkerBudget:
    platform = sys.platform if platform is None else platform
    if resource_module is None:
        try:
            import resource as resource_module
        except ImportError:
            # Windows still has the parent's 15/45s deadline, structural count,
            # file/expanded-byte and pixel budgets. Do not claim a kernel RSS cap.
            return WorkerBudget({'addressSpace': 'unavailable', 'memory': 'format-allocation-bounds',
                                 'cpu': 'parent-wall-clock', 'fileSize': 'format-output-bounds'})
    report = {
        'addressSpace': (_set_limit(resource_module, 'RLIMIT_AS', MEMORY_BYTES, MEMORY_BYTES)
                         if platform.startswith('linux') else 'not-used-reserved-vm'),
        'cpu': _set_limit(resource_module, 'RLIMIT_CPU', 40, 45),
        'fileSize': _set_limit(resource_module, 'RLIMIT_FSIZE', FILE_BYTES, FILE_BYTES),
    }
    budget = WorkerBudget(report)
    if report['addressSpace'] == 'enforced':
        report['memory'] = 'kernel-address-space'
    else:
        # Darwin getrusage reports ru_maxrss in bytes; Linux reports KiB.
        unit = 1 if platform == 'darwin' else 1024
        budget.read_memory = lambda: int(resource_module.getrusage(resource_module.RUSAGE_SELF).ru_maxrss) * unit
        budget.check()  # Verify the guard before touching user-provided bytes.
        budget.stop = threading.Event()
        budget.watcher = threading.Thread(target=_watch_resident,
            args=(budget.read_memory, budget.stop), daemon=True, name='asset-memory-budget')
        budget.watcher.start()
        report['memory'] = 'peak-rss-watchdog'
    return budget
