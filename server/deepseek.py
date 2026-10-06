"""Compatibility imports for older packaging; use server.provider in new code.

No legacy key-only configuration path remains: the destination, model, and key
must always be replaced together through ProviderService.configure(config).
"""
from server.provider import (ProviderError as DeepSeekError, ProviderService as DeepSeekService,
                             MAX_ROUNDS, MAX_TOOL_CALLS, TOOLS)

__all__ = ['DeepSeekError', 'DeepSeekService', 'MAX_ROUNDS', 'MAX_TOOL_CALLS', 'TOOLS']
