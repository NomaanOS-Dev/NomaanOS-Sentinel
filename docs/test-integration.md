# End-to-End Integration Testing Guide: Live Ingestion, Health & Notifications

This guide provides a comprehensive, step-by-step walkthrough to test the entire NomaanOS Sentinel integration lifecycle from A to Z:

$$\text{Linux Server} \longrightarrow \text{Sentinel Agent} \longrightarrow \text{Authenticated API} \longrightarrow \text{Validation \& Deduplication} \longrightarrow \text{Detection Engine} \longrightarrow \text{Security Alert} \longrightarrow \text{Dashboard \& Notification}$$

---

## 1. Terminal Windows Setup

To test the integration end-to-end, open **three terminal windows** in the repository root (`d:\Projects\6-NomaanOS-Sentinel`):

| Terminal | Purpose | Command to Run | Expected Output / URL |
|---|---|---|---|
| **Terminal 1** | **Backend API Server** | `npm.cmd run dev:api` | `http://localhost:4000` (`sentinel-api` started) |
| **Terminal 2** | **Web Console (Next.js)** | `npm.cmd run dev:web` | `http://localhost:3000` (Ready in browser) |
| **Terminal 3** | **Interactive Test Terminal** | PowerShell or Bash | Used to execute API commands & agent CLI |

---

## 2. Infrastructure Health Check

Run in **Terminal 3**:

### Check PostgreSQL Database
```powershell
docker compose ps
```
If the database container is not running:
```powershell
docker compose up -d database
```

### Check API Readiness Probe
```powershell
curl.exe -s http://localhost:4000/ready
```
**Expected Output:**
```json
{"status":"ready","checks":{"database":"ok"}}
```

---

## 3. Step-by-Step Walkthrough (A to Z)

All commands in this section are executed in **Terminal 3** using PowerShell.

### Step A: User Registration & Workspace Creation
Register a test security analyst account and create an initial workspace:

```powershell
# 1. Register account with workspace
$REG_BODY = @{
  email = "analyst_test@example.com"
  password = "Password123!"
  fullName = "Security Analyst"
  workspaceName = "Production SecOps"
} | ConvertTo-Json

$REG_RES = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/auth/register" `
  -Method Post `
  -ContentType "application/json" `
  -Body $REG_BODY `
  -SessionVariable wsSession

$WORKSPACE_ID = $REG_RES.workspace.id
Write-Host "Workspace Created: $WORKSPACE_ID" -ForegroundColor Green
```

### Step B: Configure Alert Email Notification Preferences
Configure the workspace to automatically route alerts with severity `high` or above to your notification recipients:

```powershell
$NOTIF_BODY = @{
  enabled = $true
  min_severity = "high"
  notify_emails = @("soc-lead@example.com", "analyst@example.com")
  include_evidence_summary = $true
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/v1/workspaces/$WORKSPACE_ID/notifications/settings" `
  -Method Patch `
  -WebSession $wsSession `
  -ContentType "application/json" `
  -Body $NOTIF_BODY
```

Verify that the notification settings are saved:
```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/v1/workspaces/$WORKSPACE_ID/notifications/settings" `
  -Method Get `
  -WebSession $wsSession
```

### Step C: Register Integration & Generate Enrollment Token
Register a new Linux server asset in the workspace:

```powershell
$INTEG_BODY = @{
  name = "Ubuntu-Bastion-01"
  integration_type = "linux_auth"
  description = "Production SSH and PAM Bastion Host"
} | ConvertTo-Json

$INTEG_RES = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/workspaces/$WORKSPACE_ID/integrations" `
  -Method Post `
  -WebSession $wsSession `
  -ContentType "application/json" `
  -Body $INTEG_BODY

$INTEGRATION_ID = $INTEG_RES.integration.id
Write-Host "Registered Integration: $INTEGRATION_ID" -ForegroundColor Green
```

Generate a single-use enrollment token:
```powershell
$ENROLL_RES = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/workspaces/$WORKSPACE_ID/integrations/$INTEGRATION_ID/enrollment" `
  -Method Post `
  -WebSession $wsSession

$ENROLLMENT_TOKEN = $ENROLL_RES.enrollment.enrollmentToken
Write-Host "Enrollment Token Generated: $ENROLLMENT_TOKEN" -ForegroundColor Cyan
```

### Step D: Agent Enrollment Handshake
Simulate or execute the agent enrollment exchange. The agent trades the single-use token for long-term revocable credentials:

```powershell
$ENROLL_BODY = @{ enrollment_token = $ENROLLMENT_TOKEN } | ConvertTo-Json

$AGENT_CREDS = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/integrations/enroll" `
  -Method Post `
  -ContentType "application/json" `
  -Body $ENROLL_BODY

$AGENT_ID = $AGENT_CREDS.agent_id
$AGENT_KEY = $AGENT_CREDS.agent_key

Write-Host "Agent Enrolled Successfully!" -ForegroundColor Green
Write-Host "Agent ID:  $AGENT_ID"
Write-Host "Agent Key: $AGENT_KEY"
```

### Step E: Send Heartbeat with Telemetry & Check Fleet Health
Transmit runtime diagnostics from the agent:

```powershell
$HB_BODY = @{
  diagnostics = @{
    pending_buffer_events = 0
    buffer_storage_bytes = 16384
    line_number = 450
    current_offset = 28900
    agent_version = "0.1.0"
    status = "ok"
  }
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/v1/integrations/agent/heartbeat" `
  -Method Post `
  -Headers @{
    "Authorization" = "Bearer $AGENT_KEY"
    "X-Agent-Id" = "$AGENT_ID"
  } `
  -ContentType "application/json" `
  -Body $HB_BODY
```

Query the Fleet Health API to verify the server status:
```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/v1/integrations/health?workspace_id=$WORKSPACE_ID" `
  -Method Get `
  -WebSession $wsSession
```
**Expected Output:**
```json
{
  "total": 1,
  "by_status": {
    "connected": 1,
    "degraded": 0,
    "inactive": 0,
    "disconnected": 0,
    "pending": 0,
    "revoked": 0
  },
  "events_last_24h": 0,
  "active_alerts": 0
}
```

### Step F: Ingest Attack Telemetry (Brute-Force Attack)
Send an authenticated batch of 5 failed SSH authentication events for username `admin` from IP `198.51.100.44`:

```powershell
$NOW = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$EVENTS = @(1..5 | ForEach-Object {
  @{
    id = [guid]::NewGuid().ToString()
    timestamp = $NOW
    host = "ubuntu-bastion-01"
    source_ip = "198.51.100.44"
    source_port = 45000 + $_
    event_type = "ssh_login_failure"
    outcome = "failure"
    severity = "warning"
    username = "admin"
    service = "sshd"
    message = "Failed password for admin from 198.51.100.44"
    raw_log = "Failed password for admin from 198.51.100.44 port $(45000 + $_) ssh2"
    source_line = 100 + $_
  }
})

$BATCH_BODY = @{ events = $EVENTS } | ConvertTo-Json -Depth 5

$INGEST_RES = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/integrations/agent/events" `
  -Method Post `
  -Headers @{
    "Authorization" = "Bearer $AGENT_KEY"
    "X-Agent-Id" = "$AGENT_ID"
  } `
  -ContentType "application/json" `
  -Body $BATCH_BODY

$INGEST_RES | Format-List
```

**Expected Output:**
```
acceptedCount      : 5
newlyAcceptedCount : 5
duplicateCount     : 0
rejectedCount      : 0
items              : ...
```

### Step G: Verify Alerts & Notification Email Dispatch

1. **Observe Terminal 1 (API Server):**
   ```
   [info] Completed detection evaluation on newly accepted events {"workspaceId":"...","alertCount":1}
   [info] Dispatched alert notifications {"alertId":"...","recipients":["soc-lead@example.com","analyst@example.com"]}
   [info] [DEV-EMAIL] Alert notification dispatched to soc-lead@example.com, analyst@example.com
   ```

2. **Query Alerts API:**
   ```powershell
   $ALERTS = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/workspaces/$WORKSPACE_ID/alerts" `
     -Method Get `
     -WebSession $wsSession

   $ALERTS.alerts | Format-Table id, rule_name, severity, status, created_at
   ```
   You will see an alert with `severity: high`, `rule_name: repeated_failures` (or `auth_repeated_failures`), and `status: open`.

3. **Check Notification Audit History:**
   ```powershell
   $NOTIFS = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/workspaces/$WORKSPACE_ID/notifications/history" `
     -Method Get `
     -WebSession $wsSession

   $NOTIFS.notifications | Format-Table id, alert_id, recipient_email, status, dispatched_at
   ```
   Entries for both recipients will show with status `sent`.

### Step H: Verify Deduplication Idempotency
Resend the **exact same** `$BATCH_BODY` from Step F:

```powershell
$DEDUP_RES = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/integrations/agent/events" `
  -Method Post `
  -Headers @{
    "Authorization" = "Bearer $AGENT_KEY"
    "X-Agent-Id" = "$AGENT_ID"
  } `
  -ContentType "application/json" `
  -Body $BATCH_BODY

$DEDUP_RES | Format-List
```
**Expected Output:**
```
acceptedCount      : 5
newlyAcceptedCount : 0
duplicateCount     : 5
rejectedCount      : 0
```
Because `newlyAcceptedCount` is 0, the detection engine does not re-evaluate, preventing duplicate alerts and duplicate emails.

### Step I: Verify Analyst Web Console
Open [http://localhost:3000](http://localhost:3000) in your browser:
1. Log in with `analyst_test@example.com` / `Password123!`
2. Select **Production SecOps** workspace.
3. Check the views:
   - **Overview Tab**: Displays 1 Active High Severity Alert.
   - **Integrations Tab**: Displays the Fleet Health Stat Cards (1 Server, 1 Connected, 5 Events Ingested 24h) and the agent diagnostics pill (Queue: 0, Lines: 450, v0.1.0).
   - **Notifications Tab**: Displays notification threshold settings and the sent notifications audit log.
   - **Security Events Explorer**: Shows all 5 ingested SSH failure records.

### Step J: Verify Credential Revocation
Revoke the integration:
```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/v1/workspaces/$WORKSPACE_ID/integrations/$INTEGRATION_ID/revoke" `
  -Method Post `
  -WebSession $wsSession
```

Attempt another agent heartbeat:
```powershell
try {
  Invoke-RestMethod -Uri "http://localhost:4000/api/v1/integrations/agent/heartbeat" `
    -Method Post `
    -Headers @{ "Authorization" = "Bearer $AGENT_KEY"; "X-Agent-Id" = "$AGENT_ID" } `
    -ContentType "application/json" `
    -Body '{"diagnostics":{"status":"ok"}}'
} catch {
  Write-Host "HTTP StatusCode: " $_.Exception.Response.StatusCode -ForegroundColor Red
}
```
**Expected Output:** `HTTP StatusCode: 401 Unauthorized`

---

## 4. Automated Test Commands

Run from repository root:

```powershell
# 1. API Test Suite (28 test files, 149 tests)
npm.cmd run test:api

# 2. Python Agent Test Suite (Windows)
python -m pytest services/agent/tests

# 3. Python Agent Test Suite (Ubuntu / WSL2 POSIX permissions)
wsl -- bash -lic "cd /mnt/d/Projects/6-NomaanOS-Sentinel/services/agent && python3 -m pytest tests"

# 4. Python Parser Test Suite
python -m pytest services/parser/tests

# 5. Frontend Production Build
npm.cmd run build --workspace=apps/web
```

---

## 5. Customer Onboarding & System Integration Guide

This section explains how an external customer (or a customer's IT/SecOps team) integrates NomaanOS Sentinel into their existing Linux infrastructure.

### 5.1 Architecture Overview for Customers

```
+-----------------------------------------------------------------------------------------+
| Customer Linux Infrastructure (Ubuntu, Debian, RHEL, Rocky, AlmaLinux)                 |
|                                                                                         |
|   /var/log/auth.log  ───┐                                                               |
|   or /var/log/secure ───┼─► [ Sentinel Agent Daemon ]                                  |
|                         │     ├─ Non-blocking tailing (inode tracking)                  |
|                         │     ├─ Bounded local queue (network outage protection)        |
|                         │     └─ Secure per-agent credentials (0600 POSIX permissions)  |
+-------------------------│---------------------------------------------------------------+
                          │
                          │ HTTPS / TLS (Port 443 / 4000)
                          ▼
+-----------------------------------------------------------------------------------------+
| NomaanOS Sentinel Cloud / MSP API                                                       |
|                                                                                         |
|   1. Token Validation ──► 2. Event Deduplication ──► 3. Real-Time Detection Engine      |
|                                                                │                        |
|   4. Email Alert Notification ◄────────────────────────────────┴─► 5. Web Console      |
+-----------------------------------------------------------------------------------------+
```

---

### 5.2 Step-by-Step Customer Integration Workflow

#### Step 1: Obtain Enrollment Token from Sentinel Web Console
1. The customer (or MSP administrator) logs into the **Sentinel Web Console** at `https://sentinel.yourdomain.com` (or `http://localhost:3000`).
2. Navigates to their **Workspace** (or Client Workspace) -> **Integrations** tab.
3. Clicks **Register Linux Host**:
   - Enters server name: e.g., `prod-web-01` or `auth-gateway-primary`.
   - Selects environment: `production`, `staging`, or `development`.
4. Clicks **Generate Enrollment Token**:
   - The platform creates a single-use, cryptographically secure 32-byte enrollment token valid for **1 hour**.
   - Displays the one-line deployment snippet.

---

#### Step 2: Install Sentinel Agent on Customer Linux Server

On the customer's target Linux server (run as `root` or with `sudo`):

```bash
# 1. Ensure Python 3.10+ and pip are installed
sudo apt update && sudo apt install -y python3 python3-pip python3-venv   # Debian/Ubuntu
# or: sudo dnf install -y python3 python3-pip                            # RHEL/CentOS/Rocky

# 2. Create dedicated installation directory and virtual environment
sudo mkdir -p /opt/nomaanos-sentinel
sudo python3 -m venv /opt/nomaanos-sentinel/venv
sudo /opt/nomaanos-sentinel/venv/bin/pip install --upgrade pip

# 3. Install the Sentinel Agent package
sudo /opt/nomaanos-sentinel/venv/bin/pip install /path/to/sentinel_agent-0.1.0-py3-none-any.whl
# (or install directly from customer-accessible internal repository)
```

---

#### Step 3: Execute Agent One-Time Enrollment

Run the automated enrollment command with the token generated in Step 1:

```bash
sudo /opt/nomaanos-sentinel/venv/bin/sentinel-agent enroll \
  --token "<ENROLLMENT_TOKEN>" \
  --api-url "https://api.yourdomain.com"
```

**What happens during enrollment:**
1. The agent contacts the Sentinel API endpoint `/api/v1/integrations/enroll`.
2. The platform validates the single-use token and invalidates it immediately.
3. The platform issues dedicated per-agent HMAC/bearer credentials and a unique `agent_id`.
4. The credentials are encrypted and stored locally in `/etc/nomaanos-sentinel/credentials.json` with strict `0600` permissions (readable solely by `root`).

---

#### Step 4: Configure & Start Continuous Systemd Service

Deploy the systemd unit file for resilient 24/7 background operation:

```ini
# /etc/systemd/system/sentinel-agent.service
[Unit]
Description=NomaanOS Sentinel Security Monitoring Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/opt/nomaanos-sentinel/venv/bin/sentinel-agent run --config /etc/nomaanos-sentinel/config.yaml
Restart=always
RestartSec=10
LimitNOFILE=65536

# Security hardening
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sentinel-agent
sudo systemctl status sentinel-agent
```

---

#### Step 5: Verification & Day-to-Day Operation

Once running:
1. **Live Heartbeats**: The agent reports heartbeats every 60 seconds with CPU, memory, and queue telemetry.
2. **Instant Threat Detection**:
   - Brute-force attacks (`repeated_failed_auth`) are detected within seconds of 5+ failed attempts.
   - Privilege escalation (`privileged_account_activity`) and successful login after failures (`login_after_failures`) trigger alerts immediately.
3. **Network Outage Resilience**:
   - If the customer's server loses Internet access, the agent buffers up to 10,000 log events in a local SQLite FIFO queue.
   - Once connectivity restores, events are delivered in batches without duplicates (enforced by SHA-256 fingerprint deduplication).
4. **Decommissioning / Key Revocation**:
   - When retiring a server, click **Revoke** in the Sentinel Console under **Integrations**.
   - The server's credentials are wiped immediately on the API; any subsequent connections receive HTTP 401.


