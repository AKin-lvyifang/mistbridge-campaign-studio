"""Legacy import paths remain aliases, without a separate network implementation."""
from server.deepseek import DeepSeekError, DeepSeekService
from server.provider import ProviderError, ProviderService


def test_legacy_names_are_the_generic_implementation():
    assert DeepSeekError is ProviderError
    assert DeepSeekService is ProviderService
