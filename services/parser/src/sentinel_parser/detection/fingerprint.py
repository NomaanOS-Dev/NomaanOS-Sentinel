"""
NomaanOS Sentinel — Alert Fingerprint Generator
Deterministic, stable, versioned cryptographic fingerprint computation.
"""

import hashlib
from typing import List, Optional


def compute_alert_fingerprint(
    rule_id: str,
    rule_version: str,
    workspace_id: str,
    entities: List[str],
    anchor_event_ids: List[str],
    extra_discriminator: Optional[str] = None,
) -> str:
    """
    Computes a deterministic SHA-256 alert fingerprint.

    Fingerprint inputs:
    1. rule_id (e.g. 'AUTH_REPEATED_FAILURES')
    2. rule_version (e.g. '1.0.0')
    3. workspace_id (tenant isolation boundary)
    4. normalized entity keys in stable order (e.g. ['root', '192.168.1.100'])
    5. stable sorted anchor event identifiers (e.g. [first_id, last_id])
    6. optional discriminator (e.g. specific time bucket or attack category)

    Guarantees:
    - Identical events & rule version produce identical fingerprints.
    - Changing rule_version produces a distinct fingerprint.
    - Reprocessing the exact same dataset is idempotent.
    - Different workspaces produce different fingerprints even on identical telemetry.
    """
    normalized_entities = [str(e).strip().lower() for e in entities if e is not None]
    stable_anchor_ids = sorted([str(eid).strip() for eid in anchor_event_ids if eid])

    components = [
        rule_id.strip(),
        rule_version.strip(),
        str(workspace_id).strip().lower(),
        "|".join(normalized_entities),
        "|".join(stable_anchor_ids),
    ]

    if extra_discriminator:
        components.append(extra_discriminator.strip())

    raw_payload = "::".join(components)
    return hashlib.sha256(raw_payload.encode("utf-8")).hexdigest()

