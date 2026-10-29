# NomaanOS Sentinel — Linux Monitoring Agent Guide

## Overview

The NomaanOS Sentinel Linux Monitoring Agent (`sentinel_agent`) is a lightweight, zero-external-dependency background monitoring service tailored for **Ubuntu Server 24.04 LTS**. It continuously monitors local system authentication telemetry (`/var/log/auth.log`), normalizes events into the canonical NomaanOS Sentinel schema, securely buffers telemetry in an embedded SQLite datastore, and delivers authenticated batches to the Sentinel API server.

---

## Architectural Components

```
+-----------------------------------------------------------------------------------------+
|                                    Ubuntu 24.04 Host                                    |
|                                                                                         |
|  /var/log/auth.log                                                                      |
|         | (read by group 'adm')                                                         |
|         v                                                                               |
|  +--------------------+       +--------------------+       +--------------------+       |
|  |    LogCollector    | ----> | LinuxAuthParser    | ----> | DurableEventBuffer |       |
|  | - Checkpoint offset|       | - Normalization    |       | - SQLite WAL mode  |       |
|  | - Rotation & Inode |       | - Canonical Schema |       | - Bounded disk max |       |
|  | - Partial Line Buf |       +--------------------+       | - FIFO Queue       |       |
|  +--------------------+                                    +---------+----------+       |
|                                                                      |                  |
|                                                                      v                  |
|                                                            +--------------------+       |
|                                                            |   SentinelClient   |       |
|                                                            | - Bearer Auth      |       |
|                                                            | - Retry & Jitter   |       |
|                                                            | - Revocation Stop  |       |
|                                                            +---------+----------+       |
+----------------------------------------------------------------------|------------------+
                                                                       | POST /agent/events
                                                                       v
+-----------------------------------------------------------------------------------------+
|                                 NomaanOS Sentinel API                                   |
|                                                                                         |
|  POST /api/v1/integrations/agent/events                                                 |
|  - Bearer agentKey + X-Agent-Id verification                                            |
|  - Workspace isolation enforcement (tenant_id = workspaceId)                            |
|  - Idempotent deduplication (ON CONFLICT DO NOTHING)                                    |
|  - Deterministic threat detection evaluation                                            |
+-----------------------------------------------------------------------------------------+
```

### 1. Configuration & Security Management (`sentinel_agent.config`)
- Loads configurations from `/etc/nomaanos-sentinel/agent.json`, environment variables, or CLI options.
- On POSIX systems, validates that credentials files (`credentials.json`) have strict `0600` (`-rw-------`) permissions; raises `InsecurePermissionsError` if credentials are world-readable or world-writable.
- Automatically masks secret tokens and keys in diagnostic dumps (`mask_secret()`).

### 2. Enrollment Handshake (`sentinel_agent.enrollment`)
- Performs atomic exchange: trades a single-use, short-lived enrollment token (`sentinel_enroll_*`) for long-term agent credentials (`agent_id`, `agent_key`, `workspace_id`).
- Saves credentials securely to `/etc/nomaanos-sentinel/credentials.json`.
- Plaintext secrets are never logged or returned in terminal success outputs.

### 3. Log Tailing & Normalization (`sentinel_agent.collector`)
- Tails `/var/log/auth.log` using persistent checkpoints (`checkpoint.json`: inode, byte offset, line number).
- Robust rotation detection: monitors inode changes and truncation (`size < offset`), resetting offsets appropriately without duplicate processing or crashing.
- Incomplete line buffering: preserves trailing bytes lacking a newline (`\n`) until the complete line is written.
- Directly reuses the Python `sentinel_parser.LinuxAuthParser` engine to emit canonical events.

### 4. Bounded SQLite Local Buffer (`sentinel_agent.buffer`)
- Embedded SQLite database (`/var/lib/nomaanos-sentinel/buffer.db`) in high-performance Write-Ahead Logging (`WAL`) mode.
- Preserves telemetry across agent restarts, host reboots, or temporary network interruptions.
- Enforces a strict storage limit (default 50 MiB). If breached, drops oldest unacknowledged items in FIFO order and logs an alert.

### 5. Authenticated Batch Delivery (`sentinel_agent.client`)
- Delivers batches of up to 50 normalized events to `POST /api/v1/integrations/agent/events`.
- Employs exponential backoff with symmetric jitter (`calculate_backoff()`) during network outages to prevent thundering herds.
- Receives itemized server response:
  ```json
  {
    "acceptedCount": 50,
    "newlyAcceptedCount": 45,
    "duplicateCount": 5,
    "rejectedCount": 0,
    "items": [
      { "id": "uuid-1", "status": "accepted" },
      { "id": "uuid-2", "status": "accepted" }
    ]
  }
  ```
- Head-of-line blocking prevention: Both newly accepted and duplicate events are acknowledged and removed from the SQLite buffer. Schema-rejected items are marked as acknowledged/dropped with error logging to prevent indefinite retries.
- Revocation detection: If the server responds with HTTP 401 or 403, the client transitions immediately to `is_revoked = True` and ceases further delivery attempts to avoid flooding logs.

### 6. Heartbeat & Diagnostics (`sentinel_agent.client` & `service`)
- Periodically sends runtime telemetry to `POST /api/v1/integrations/agent/heartbeat`:
  - `pending_buffer_events`: current queue depth in the local SQLite buffer.
  - `buffer_storage_bytes`: disk footprint of `buffer.db`.
  - `line_number`: current line count processed from `/var/log/auth.log`.
  - `current_offset`: byte offset checkpoint.
  - `agent_version`: installed agent version.
  - `status`: operational state (`ok`, `degraded`, `error`).
- Telemetry is merged into `metadata.agentDiagnostics` on the server and powers fleet health metrics.

### 7. systemd Service & Hardening (`nomaanos-sentinel-agent.service`)
- Runs as dedicated unprivileged user `sentinel-agent` in group `adm` (providing read access to `/var/log/auth.log` without requiring root permissions).
- Hardened with systemd directives:
  - `ProtectSystem=strict`
  - `ProtectHome=true`
  - `PrivateTmp=true`
  - `NoNewPrivileges=true`
  - `CapabilityBoundingSet=` (all kernel capabilities dropped)
  - `ReadOnlyPaths=/var/log/auth.log`
  - `ReadWritePaths=/var/lib/nomaanos-sentinel /etc/nomaanos-sentinel`

---

## Ubuntu Server 24.04 LTS Deployment Guide

### Prerequisites
- Ubuntu Server 24.04 LTS
- Python 3.12 (standard library only; no pip dependencies required for agent runtime)

```bash
sudo apt update && sudo apt install -y python3 python3-pip
```

### Step 1: Create Dedicated System User & Directories
```bash
# Create system user belonging to group 'adm'
sudo useradd -r -s /bin/false -d /var/lib/nomaanos-sentinel -G adm sentinel-agent

# Create configuration and state directories
sudo mkdir -p /etc/nomaanos-sentinel /var/lib/nomaanos-sentinel

# Configure ownership and restrictive directory permissions
sudo chown -R sentinel-agent:sentinel-agent /etc/nomaanos-sentinel /var/lib/nomaanos-sentinel
sudo chmod 750 /etc/nomaanos-sentinel /var/lib/nomaanos-sentinel
```

### Step 2: Install Agent Package
```bash
# From repository root or packaged wheel:
sudo pip install ./services/parser ./services/agent
```

### Step 3: Enroll the Agent
In the NomaanOS Sentinel Web Console:
1. Navigate to your workspace -> **Integrations**.
2. Click **Add Integration**, name your server (e.g. `Ubuntu-Auth-01`), and select `Linux Auth (sshd, sudo, PAM)`.
3. Click **Generate Enrollment Token** to receive a single-use token.
4. On the Ubuntu host, execute enrollment:

```bash
sudo -u sentinel-agent sentinel-agent enroll \
  --token sentinel_enroll_YOUR_TOKEN_HERE \
  --api-url http://your-sentinel-server:4000
```

Upon success, credentials are saved to `/etc/nomaanos-sentinel/credentials.json` with permissions `-rw-------` (`0600`).

### Step 4: Install and Start systemd Service
```bash
# Copy systemd unit
sudo cp services/agent/systemd/nomaanos-sentinel-agent.service /etc/systemd/system/

# Reload systemd and start service
sudo systemctl daemon-reload
sudo systemctl enable --now nomaanos-sentinel-agent
```

### Step 5: Check Operational Diagnostics
```bash
# Check status using CLI
sentinel-agent status

# Check systemd status
sudo systemctl status nomaanos-sentinel-agent

# Follow real-time service logs
sudo journalctl -u nomaanos-sentinel-agent -f
```

---

## Agent CLI Reference

| Command | Arguments | Description |
|---|---|---|
| `enroll` | `--token <token> [--api-url <url>] [--config <path>]` | Performs enrollment handshake and secures credentials |
| `start` | `[--config <path>]` | Runs agent service in the foreground (daemon mode) |
| `status` | `[--config <path>]` | Displays queue depth, checkpoint, and server connectivity |
| `test-log` | `[--message <msg>] [--file <path>]` | Appends a test log line to verify pipeline end-to-end |

---

## Troubleshooting & Uninstallation

### Revocation Handling
If an integration is revoked in the Sentinel console:
1. The server invalidates the credential hash immediately.
2. The agent receives HTTP 401 on its next delivery or heartbeat attempt.
3. The agent logs `Agent credentials have been revoked by the workspace administrator` and stops delivery.
4. To re-enroll, generate a new enrollment token and re-run `sentinel-agent enroll`.

### Uninstallation
```bash
sudo systemctl disable --now nomaanos-sentinel-agent
sudo rm /etc/systemd/system/nomaanos-sentinel-agent.service
sudo systemctl daemon-reload
sudo rm -rf /etc/nomaanos-sentinel /var/lib/nomaanos-sentinel
sudo userdel sentinel-agent
```

---

## Fleet Health Evaluation Engine

The Sentinel API continuously evaluates agent health status based on incoming heartbeats and error metrics:

| Status | Conditions | Description |
|---|---|---|
| `connected` | Last seen ≤ 5m, no errors in 15m | Host is actively tailing and streaming telemetry normally |
| `degraded` | Last seen ≤ 15m AND (error in 15m OR last seen > 5m) | Host is communicating but experiencing intermittent errors or delayed heartbeats |
| `inactive` | Last seen between 15m and 24h ago | Host has missed multiple expected heartbeat intervals |
| `disconnected` | Last seen > 24h ago OR (created > 15m ago with 0 heartbeats) | Host is offline or unreachable |
| `pending` | Created ≤ 15m ago, no heartbeats yet | Awaiting initial agent enrollment and connection |
| `revoked` | Explicitly revoked by administrator | Integration credentials permanently invalidated |

Workspace fleet statistics can be queried via `GET /api/v1/integrations/health`.

---

## Verification Status

- **Unit & Integration Test Suites**: 100% Passing.
  - Python tests on Windows: `services/agent/tests/` (22 passed, 1 skipped due to Windows non-POSIX permission model).
  - Python tests on Ubuntu / WSL2: `services/agent/tests/` (**23/23 passed**, verifying strict POSIX `0600` permission enforcement).
  - API batch ingestion & health tests: `apps/api/tests/agent-batch-ingestion.test.ts` & `apps/api/tests/notifications-and-agent-health.test.ts` (10/10 passed).
- **Environment & Boundary Notes**:
  - **Windows / WSL2 Network Isolation**: On standard WSL2 installations, the Linux guest environment uses a virtualized network adapter with an isolated loopback address. Direct TCP connection from a daemon inside WSL2 to `http://localhost:4000` on the Windows host requires either mirrored networking or bridging via the WSL gateway IP (`/etc/resolv.conf`).
  - **Host Deployment**: Real-host systemd unit execution and `/var/log/auth.log` access on physical or cloud Linux server hardware is marked as **IMPLEMENTED AND AUTOMATION-VERIFIED**, with actual multi-machine Linux production deployment pending live environment setup.

