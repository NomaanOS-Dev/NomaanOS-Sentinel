"""
NomaanOS Sentinel — Agent Service Orchestration and Lifecycle.
"""

import logging
import signal
import time
from datetime import datetime, timezone
from typing import Optional

from sentinel_agent.buffer import DurableEventBuffer
from sentinel_agent.client import (
    SentinelClient,
    AgentRevokedError,
    DeliveryNetworkError,
    SchemaRejectionError,
    calculate_backoff,
)
from sentinel_agent.collector import LogCollector
from sentinel_agent.config import AgentConfig

logger = logging.getLogger("sentinel_agent.service")


class AgentService:
    """
    Main background daemon service for the Linux monitoring agent.
    Coordinates log tailing, normalization, local durable buffering,
    authenticated delivery with retry backoff, and heartbeat health reporting.
    """

    def __init__(self, config: AgentConfig):
        self.config = config
        self.running = False
        self._stop_requested = False
        self.status = "STOPPED"
        self.retry_attempt = 0
        self.last_heartbeat_time = 0.0

        # Initialize durable buffer
        self.buffer = DurableEventBuffer(
            db_path=self.config.buffer_path,
            max_buffer_bytes=self.config.max_buffer_bytes,
        )

        # Initialize log collector
        self.collector = LogCollector(
            log_path=self.config.log_file,
            checkpoint_path=self.config.checkpoint_path,
            workspace_id=self.config.workspace_id,
        )

        # Initialize HTTP client if credentials exist
        self.client: Optional[SentinelClient] = None
        if self.config.is_enrolled():
            self.client = SentinelClient(
                api_url=self.config.api_url,
                agent_id=str(self.config.agent_id),
                agent_key=str(self.config.agent_key),
            )

    def _setup_signals(self) -> None:
        """Register POSIX and systemd termination signal handlers."""
        signal.signal(signal.SIGINT, self._handle_signal)
        signal.signal(signal.SIGTERM, self._handle_signal)

    def _handle_signal(self, signum: int, frame) -> None:
        signame = signal.Signals(signum).name if hasattr(signal, "Signals") else str(signum)
        logger.info(f"Received signal {signame}. Initiating graceful agent shutdown.")
        self.stop()

    def start(self) -> None:
        """Start the monitoring agent run loop."""
        if not self.config.is_enrolled():
            logger.error(
                "Agent is not enrolled. Cannot start service. "
                "Run 'sentinel-agent enroll --token <token>' first."
            )
            self.status = "NOT_ENROLLED"
            return

        self._setup_signals()
        self.running = True
        self._stop_requested = False
        self.status = "RUNNING"
        self.retry_attempt = 0

        logger.info(
            f"NomaanOS Sentinel Agent started. "
            f"Monitoring: {self.config.log_file}, Target API: {self.config.api_url}, "
            f"Workspace: {self.config.workspace_id}"
        )

        try:
            while self.running and not self._stop_requested:
                self.tick()
        except KeyboardInterrupt:
            logger.info("Keyboard interrupt received.")
        finally:
            self._cleanup()

    def tick(self) -> None:
        """Single iteration of collect, deliver, and heartbeat."""
        now = time.time()

        # 1. Collect new log entries from source
        try:
            new_events = self.collector.collect_new_events()
            if new_events:
                enqueued = self.buffer.enqueue_events(new_events)
                logger.debug(f"Collected and buffered {enqueued} new security events")
        except Exception as e:
            logger.error(f"Error during log collection: {e}")

        # 2. Deliver buffered events
        if self.client and not self.client.is_revoked:
            batch = None
            try:
                batch = self.buffer.peek_batch(limit=self.config.batch_size)
                if batch:
                    logger.debug(f"Attempting delivery of batch with {len(batch)} events")
                    res = self.client.deliver_batch(batch)
                    
                    # Handle itemized batch acceptance (accepted, duplicate, rejected)
                    items = res.get("items")
                    if isinstance(items, list) and items:
                        ack_ids = []
                        for it in items:
                            item_id = it.get("id")
                            item_status = it.get("status")
                            if item_status in ("accepted", "duplicate"):
                                ack_ids.append(item_id)
                            elif item_status == "rejected":
                                logger.warning(
                                    f"Event {item_id} rejected by Sentinel server: {it.get('reason')}. "
                                    "Acknowledging to clear poison pill from local buffer."
                                )
                                ack_ids.append(item_id)
                        if ack_ids:
                            self.buffer.acknowledge_batch(ack_ids)
                    else:
                        # Fallback for standard whole-batch acknowledgement
                        event_ids = [e["id"] for e in batch if "id" in e]
                        self.buffer.acknowledge_batch(event_ids)

                    self.retry_attempt = 0
                    self.status = "RUNNING"
                    logger.info(
                        f"Delivered {len(batch)} events to Sentinel API (Batch ID: {res.get('batchId')}, "
                        f"Accepted: {res.get('acceptedCount', len(batch))})"
                    )
            except AgentRevokedError:
                self.status = "REVOKED"
                self.running = False
                logger.critical("Agent revoked by administrator. Stopping agent service.")
                return
            except SchemaRejectionError as e:
                logger.error(f"Schema validation failure: {e}")
                # Drop all items in the rejected batch to prevent persistent queue blockage
                if batch:
                    event_ids = [e["id"] for e in batch if "id" in e]
                    self.buffer.acknowledge_batch(event_ids)
            except DeliveryNetworkError as e:
                self.retry_attempt += 1
                self.status = "BACKOFF"
                backoff_delay = calculate_backoff(
                    self.retry_attempt,
                    base=self.config.initial_retry_backoff_secs,
                    max_backoff=self.config.max_retry_backoff_secs,
                )
                logger.warning(
                    f"Delivery failed (attempt {self.retry_attempt}): {e}. "
                    f"Retrying in {backoff_delay:.1f}s."
                )
                self._interruptible_sleep(backoff_delay)
                return

        # 3. Heartbeat reporting with runtime telemetry
        if self.client and (now - self.last_heartbeat_time >= self.config.heartbeat_interval_secs):
            try:
                diagnostics = {
                    "pending_buffer_events": self.buffer.get_pending_count(),
                    "buffer_storage_bytes": self.buffer.get_size_bytes(),
                    "line_number": self.collector.line_number,
                    "current_offset": self.collector.current_offset,
                    "status": self.status,
                    "agent_version": "0.1.0",
                }
                self.client.send_heartbeat(diagnostics=diagnostics)
                self.last_heartbeat_time = now
                logger.debug("Heartbeat acknowledged by Sentinel server with telemetry")
            except AgentRevokedError:
                self.status = "REVOKED"
                self.running = False
                return
            except DeliveryNetworkError as e:
                logger.warning(f"Heartbeat network warning: {e}")

        # 4. Standard poll interval sleep
        self._interruptible_sleep(self.config.poll_interval_secs)

    def _interruptible_sleep(self, seconds: float) -> None:
        """Sleep in small 0.1s increments so stop requests respond immediately."""
        end_time = time.time() + seconds
        while time.time() < end_time and not self._stop_requested:
            time.sleep(0.1)

    def stop(self) -> None:
        """Initiate graceful shutdown."""
        self._stop_requested = True
        self.running = False
        self.status = "STOPPING"

    def _cleanup(self) -> None:
        """Flush final telemetry and release database handles."""
        logger.info("Performing final buffer flush and cleanup...")
        try:
            self.buffer.close()
        except Exception as e:
            logger.error(f"Error closing buffer: {e}")
        self.status = "STOPPED"
        logger.info("Sentinel agent service stopped successfully.")

    def get_diagnostics(self) -> dict:
        """Retrieve runtime health and diagnostic metrics without exposing secrets."""
        pending_count = self.buffer.get_pending_count()
        storage_bytes = self.buffer.get_size_bytes()
        return {
            "status": self.status,
            "is_enrolled": self.config.is_enrolled(),
            "agent_id": self.config.agent_id,
            "workspace_id": self.config.workspace_id,
            "integration_id": self.config.integration_id,
            "log_file": self.config.log_file,
            "api_url": self.config.api_url,
            "pending_buffer_events": pending_count,
            "buffer_storage_bytes": storage_bytes,
            "current_inode": self.collector.current_inode,
            "current_offset": self.collector.current_offset,
            "line_number": self.collector.line_number,
        }
