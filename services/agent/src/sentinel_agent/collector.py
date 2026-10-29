"""
NomaanOS Sentinel — Linux Authentication Log Collector and Tailing Engine.
"""

import json
import logging
import os
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger("sentinel_agent.collector")

# Resilient import of sentinel_parser in both monorepo and installed environments
try:
    from sentinel_parser.parser import LinuxAuthParser, LineStatus
except ImportError:
    repo_parser_src = Path(__file__).resolve().parent.parent.parent.parent / "parser" / "src"
    if repo_parser_src.exists():
        sys.path.insert(0, str(repo_parser_src))
    from sentinel_parser.parser import LinuxAuthParser, LineStatus


class LogCollector:
    """
    Robust log collector tailing /var/log/auth.log.
    Features:
    - Persistent checkpointing (inode, byte offset, line number, modification time).
    - Log rotation detection (detects inode changes and log truncation).
    - Incomplete line buffering (never normalizes partial lines).
    - Normalization into canonical security events using LinuxAuthParser.
    """

    def __init__(
        self,
        log_path: str = "/var/log/auth.log",
        checkpoint_path: str = "/var/lib/nomaanos-sentinel/checkpoint.json",
        workspace_id: Optional[str] = None,
        default_year: Optional[int] = None,
    ):
        self.log_path = str(Path(log_path).resolve())
        self.checkpoint_path = str(Path(checkpoint_path).resolve())
        self.workspace_id = workspace_id
        self.parser = LinuxAuthParser(default_year=default_year)

        self.current_inode: Optional[int] = None
        self.current_offset: int = 0
        self.line_number: int = 0
        self.partial_line: str = ""

        # Ensure checkpoint directory exists
        Path(self.checkpoint_path).parent.mkdir(parents=True, exist_ok=True)
        self._load_checkpoint()

    def set_workspace_id(self, workspace_id: str) -> None:
        """Update workspace ID attribution for normalized events."""
        self.workspace_id = workspace_id

    def _load_checkpoint(self) -> None:
        """Load persistent checkpoint state from disk if available."""
        p = Path(self.checkpoint_path)
        if not p.is_file():
            return

        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.current_inode = data.get("inode")
                self.current_offset = data.get("offset", 0)
                self.line_number = data.get("line_number", 0)
                logger.info(
                    f"Loaded checkpoint for '{self.log_path}': "
                    f"inode={self.current_inode}, offset={self.current_offset}, line={self.line_number}"
                )
        except Exception as e:
            logger.warning(f"Failed to read checkpoint from '{self.checkpoint_path}': {e}")

    def _save_checkpoint(self, inode: int, offset: int, mtime: float, line_no: int) -> None:
        """Atomically persist checkpoint state to disk."""
        data = {
            "log_path": self.log_path,
            "inode": inode,
            "offset": offset,
            "last_mtime": mtime,
            "line_number": line_no,
        }

        tmp_path = f"{self.checkpoint_path}.tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(tmp_path, self.checkpoint_path)
        except Exception as e:
            logger.error(f"Failed to write checkpoint to '{self.checkpoint_path}': {e}")
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

    def collect_new_events(self, max_lines: int = 1000) -> List[Dict[str, Any]]:
        """
        Poll the log file for newly appended telemetry.
        Handles rotation, non-blocking reads, and returns normalized canonical event dictionaries.
        """
        log_file = Path(self.log_path)
        if not log_file.is_file():
            return []

        try:
            file_stat = log_file.stat()
        except OSError as e:
            logger.warning(f"Could not stat log file '{self.log_path}': {e}")
            return []

        inode = file_stat.st_ino
        size = file_stat.st_size
        mtime = file_stat.st_mtime

        # Check for file rotation (inode change) or truncation
        if self.current_inode is not None and inode != self.current_inode:
            logger.info(
                f"Log rotation detected: inode changed from {self.current_inode} to {inode}. "
                "Resetting collection offset to beginning of new file."
            )
            self.current_inode = inode
            self.current_offset = 0
            self.line_number = 0
            self.partial_line = ""
        elif size < self.current_offset:
            logger.info(
                f"Log truncation detected: file size ({size}b) is smaller than offset ({self.current_offset}b). "
                "Resetting offset to 0."
            )
            self.current_offset = 0
            self.line_number = 0
            self.partial_line = ""

        if self.current_inode is None:
            self.current_inode = inode

        # If no new bytes appended, nothing to do
        if size == self.current_offset and not self.partial_line:
            return []

        events: List[Dict[str, Any]] = []

        try:
            with open(self.log_path, "r", encoding="utf-8", errors="replace") as f:
                f.seek(self.current_offset)
                chunk = f.read(64 * 1024)  # 64 KB read buffer
                if not chunk:
                    return []

                raw_content = self.partial_line + chunk
                lines = raw_content.split("\n")

                # The last item indicates whether we ended on a newline
                if raw_content.endswith("\n"):
                    complete_lines = lines[:-1]
                    self.partial_line = ""
                else:
                    complete_lines = lines[:-1]
                    self.partial_line = lines[-1]

                for raw_line in complete_lines:
                    if len(events) >= max_lines:
                        break

                    line_stripped = raw_line.strip()
                    if not line_stripped:
                        continue

                    self.line_number += 1
                    status, event = self.parser.classify_and_parse_line(
                        raw_line,
                        line_number=self.line_number,
                        tenant_id=self.workspace_id,
                        ingestion_source="linux_agent",
                    )

                    if status == LineStatus.VALID and event:
                        events.append(event.to_dict())

                # Compute new byte offset safely accounting for any leftover partial line
                current_tell = f.tell()
                partial_bytes = len(self.partial_line.encode("utf-8"))
                new_offset = max(0, current_tell - partial_bytes)
                self.current_offset = new_offset

                self._save_checkpoint(self.current_inode, self.current_offset, mtime, self.line_number)

        except Exception as e:
            logger.error(f"Error reading log file '{self.log_path}': {e}")

        return events

