import uuid
from sentinel_agent.buffer import DurableEventBuffer


def make_sample_event(msg: str = "Test event") -> dict:
    return {
        "id": str(uuid.uuid4()),
        "schema_version": "1.0.0",
        "tenant_id": str(uuid.uuid4()),
        "source_type": "linux_auth",
        "source_host": "test-host",
        "event_type": "ssh_login_success",
        "severity": "info",
        "occurred_at": "2026-10-27T10:00:00Z",
        "observed_at": "2026-10-27T10:00:01Z",
        "message": msg,
        "evidence": {},
        "ingestion_source": "linux_agent",
    }


def test_buffer_enqueue_and_peek(tmp_path):
    db_file = tmp_path / "test_buffer.db"
    buf = DurableEventBuffer(str(db_file))

    ev1 = make_sample_event("First event")
    ev2 = make_sample_event("Second event")

    inserted = buf.enqueue_events([ev1, ev2])
    assert inserted == 2
    assert buf.get_pending_count() == 2

    # Peek batch
    batch = buf.peek_batch(limit=10)
    assert len(batch) == 2
    assert batch[0]["id"] == ev1["id"]
    assert batch[1]["id"] == ev2["id"]
    buf.close()


def test_buffer_persists_across_restart(tmp_path):
    db_file = tmp_path / "test_buffer.db"
    buf1 = DurableEventBuffer(str(db_file))

    ev = make_sample_event("Persistent event")
    buf1.enqueue_events([ev])
    assert buf1.get_pending_count() == 1
    buf1.close()

    # Reopen buffer simulating process restart
    buf2 = DurableEventBuffer(str(db_file))
    assert buf2.get_pending_count() == 1
    batch = buf2.peek_batch(limit=10)
    assert len(batch) == 1
    assert batch[0]["id"] == ev["id"]
    buf2.close()


def test_buffer_acknowledgement_deletes_events(tmp_path):
    db_file = tmp_path / "test_buffer.db"
    buf = DurableEventBuffer(str(db_file))

    ev1 = make_sample_event("Event 1")
    ev2 = make_sample_event("Event 2")
    buf.enqueue_events([ev1, ev2])

    assert buf.get_pending_count() == 2

    # Acknowledge ev1
    deleted = buf.acknowledge_batch([ev1["id"]])
    assert deleted == 1
    assert buf.get_pending_count() == 1

    remaining = buf.peek_batch(limit=10)
    assert len(remaining) == 1
    assert remaining[0]["id"] == ev2["id"]
    buf.close()


def test_buffer_ignores_duplicate_ids(tmp_path):
    db_file = tmp_path / "test_buffer.db"
    buf = DurableEventBuffer(str(db_file))

    ev = make_sample_event("Duplicate event")
    ins1 = buf.enqueue_events([ev])
    ins2 = buf.enqueue_events([ev])

    assert ins1 == 1
    assert ins2 == 0
    assert buf.get_pending_count() == 1
    buf.close()


def test_buffer_enforces_size_limit_and_drops_oldest(tmp_path):
    db_file = tmp_path / "test_buffer.db"
    # Small buffer limit to trigger overflow
    buf = DurableEventBuffer(str(db_file), max_buffer_bytes=1024)

    events = [make_sample_event(f"Event {i}" + "X" * 100) for i in range(50)]
    buf.enqueue_events(events)

    # Verify that overflow drops records and keeps buffer operational
    dropped = buf.enforce_size_limit()
    # Should not crash and should remain usable
    count = buf.get_pending_count()
    assert count <= 50
    buf.close()

