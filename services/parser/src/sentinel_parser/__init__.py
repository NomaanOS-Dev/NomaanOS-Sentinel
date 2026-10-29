"""NomaanOS Sentinel Security Event Parser Foundation."""

from sentinel_parser.models import (
    NormalizedSecurityEvent,
    EventType,
    SeverityLevel,
    SourceType,
    IngestionSource,
    ParseSummary,
)
from sentinel_parser.parser import (
    LinuxAuthParser,
    parse_line,
    parse_file,
    parse_lines,
)
from sentinel_parser.self_check import run_self_check

__version__ = "0.1.0"

__all__ = [
    "NormalizedSecurityEvent",
    "EventType",
    "SeverityLevel",
    "SourceType",
    "IngestionSource",
    "ParseSummary",
    "LinuxAuthParser",
    "parse_line",
    "parse_file",
    "parse_lines",
    "run_self_check",
    "__version__",
]

