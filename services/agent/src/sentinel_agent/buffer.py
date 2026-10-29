"""
NomaanOS Sentinel — Bounded SQLite Durable Local Buffer.
"""

import json
import logging
import os
import sqlite3
from pathlib import Path
from typing import List, Dict, Any, Optional

logger = logging.getLogger("sentinel_agent.buffer")


class DurableEventBuffer:
    """
    SQLite-backed durable FIFO buffer.
    Guarantees no data loss across agent restarts, power interruptions, or transient network outages.
    Enforces strict bounded disk storage limits and drops oldest unacknowledged events on overflow.
    """

    def __init__(self, db_path: str, max_buffer_bytes: int = 50 * 1024 * 1024):
        self.db_path = str(Path(db_path).resolve())
        self.max_buffer_bytes = max_buffer_bytes

        # Ensure directory exists
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(
                self.db_path,
                timeout=15.0,
                isolation_level=None,  # autocommit mode / explicit transactions
                check_same_thread=False,
            )
            # Configure high-performance WAL mode for crash resilience and concurrency
            self._conn.execute("PRAGMA journal_mode=WAL;")
            self._conn.execute("PRAGMA synchronous=NORMAL;")
        return self._conn

    def _init_db(self) -> None:
        conn = self._get_connection()
        with conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS event_buffer (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL UNIQUE,
                    event_json TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_buffer_id ON event_buffer (id ASC);
                """
            )

    def enqueue_events(self, events: List[Dict[str, Any]]) -> int:
        """
        Enqueue a batch of normalized security event dicts into the durable buffer.
        Duplicate event IDs are safely ignored.
        """
        if not events:
            return 0

        conn = self._get_connection()
        inserted = 0

        with conn:
            cursor = conn.cursor()
            for ev in events:
                event_id = ev.get("id")
                if not event_id:
                    continue
                try:
                    payload_json = json.dumps(ev)
                    cursor.execute(
                        "INSERT OR IGNORE INTO event_buffer (event_id, event_json) VALUES (?, ?);",
                        (event_id, payload_json),
                    )
                    if cursor.rowcount > 0:
                        inserted += 1
                except sqlite3.Error as e:
                    logger.error(f"Error buffering event {event_id}: {e}")

        self.enforce_size_limit()
        return inserted

    def peek_batch(self, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Fetch up to `limit` oldest unacknowledged events from the buffer in FIFO order.
        Events remain in the buffer until explicitly acknowledged.
        """
        if limit <= 0:
            return []

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT event_json FROM event_buffer ORDER BY id ASC LIMIT ?;",
            (limit,),
        )
        rows = cursor.fetchall()

        events: List[Dict[str, Any]] = []
        for (json_str,) in rows:
            try:
                events.append(json.loads(json_str))
            except Exception as e:
                logger.error(f"Failed to parse buffered event JSON: {e}")

        return events

    def acknowledge_batch(self, event_ids: List[str]) -> int:
        """
        Atomically delete delivered events from the buffer upon successful server acknowledgment.
        """
        if not event_ids:
            return 0

        conn = self._get_connection()
        deleted = 0

        with conn:
            cursor = conn.cursor()
            # Batch delete in chunks of 500 to stay well under SQLite parameter limits
            chunk_size = 500
            for i in range(0, len(event_ids), chunk_size):
                chunk = event_ids[i : i + chunk_size]
                placeholders = ",".join("?" for _ in chunk)
                cursor.execute(
                    f"DELETE FROM event_buffer WHERE event_id IN ({placeholders});",
                    chunk,
                )
                deleted += cursor.rowcount

        return deleted

    def enforce_size_limit(self) -> int:
        """
        Verify that buffer file size does not exceed `max_buffer_bytes`.
        If exceeded, drop the oldest unacknowledged events and log an alert.
        """
        current_size = self.get_size_bytes()
        if current_size <= self.max_buffer_bytes:
            return 0

        logger.warning(
            f"Buffer storage size ({current_size} bytes) exceeds limit ({self.max_buffer_bytes} bytes). "
            "Executing overflow policy: discarding oldest unacknowledged telemetry."
        )

        conn = self._get_connection()
        dropped = 0

        with conn:
            cursor = conn.cursor()
            # Drop 100 oldest records at a time until under threshold or empty
            while current_size > self.max_buffer_bytes:
                cursor.execute(
                    """
                    DELETE FROM event_buffer 
                    WHERE id IN (SELECT id FROM event_buffer ORDER BY id ASC LIMIT 100);
                    """
                )
                count = cursor.rowcount
                if count == 0:
                    break
                dropped += count
                current_size = self.get_size_bytes()

        if dropped > 0:
            logger.warning(f"Buffer overflow policy dropped {dropped} unacknowledged events.")

        return dropped

    def get_pending_count(self) -> int:
        """Return total number of pending events waiting in the buffer."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM event_buffer;")
        row = cursor.fetchone()
        return row[0] if row else 0

    def get_size_bytes(self) -> int:
        """Calculate total disk space consumed by SQLite DB and associated journal/WAL files."""
        total = 0
        base_path = Path(self.db_path)
        for p in [base_path, Path(f"{self.db_path}-wal"), Path(f"{self.db_path}-shm")]:
            if p.is_file():
                try:
                    total += p.stat().st_size
                except OSError:
                    pass
        return total

    def close(self) -> None:
        """Safely close database connection and checkpoint WAL."""
        if self._conn:
            try:
                self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
                self._conn.close()
            except Exception:
                pass
            finally:
                self._conn = None

