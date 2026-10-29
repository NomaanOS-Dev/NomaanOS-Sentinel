# NomaanOS Sentinel — Local Development Guide

This guide describes how to configure, run, and test the NomaanOS Sentinel platform locally on Windows, macOS, or Linux.

---

## 1. Prerequisites

Ensure the following runtimes and tools are installed:
- **Node.js**: `v20.x` or `v24.x` (tested on `v24.21.0`)
- **npm**: `v10.x` or `v11.x`
- **Python**: `3.10+` (tested on Python `3.12.10`)
- **Docker & Docker Compose**: Docker 26+ (tested on Docker `29.8.2` and Compose `v5.6.0`)
- **Git**: `2.40+`

---

## 2. Initial Setup

### 2.1 Clone and Environment Setup
Copy the template configuration to create your local `.env`:
```powershell
# In PowerShell (Windows)
Copy-Item .env.example .env

# In bash / zsh (macOS / Linux)
cp .env.example .env
```

Review `.env` to ensure the settings match your local environment. Notice:
- By default, PostgreSQL is mapped to host port `5433` (`127.0.0.1:5433`) to prevent collisions if port `5432` is bound by other local database instances.

### 2.2 Install Node Dependencies
Run from the repository root:
```powershell
npm.cmd install
```
*(On macOS/Linux, simply run `npm install`)*

### 2.3 Configure Python Environment
Install optional dev dependencies for the parser:
```powershell
# Windows
python -m pip install pytest jsonschema

# macOS / Linux
pip install pytest jsonschema
```

---

## 3. Database Management

### 3.1 Start PostgreSQL via Docker Compose
```powershell
docker compose up -d database
```

Check container health:
```powershell
docker compose ps
```
The status should indicate `(healthy)`.

### 3.2 Run Database Migrations
Apply versioned migrations to PostgreSQL:
```powershell
npm.cmd run db:migrate
```
Expected output:
```
Migrations applied: [
  '001_create_security_events.sql',
  '002_create_auth_and_workspaces.sql',
  '003_create_datasets_and_jobs.sql',
  '004_add_dataset_processing_metadata.sql',
  '005_create_alerts.sql',
  '006_create_cases.sql',
  '007_create_ai_investigations.sql',
  '008_create_integrations_and_enrollment.sql',
  '009_create_notifications_and_agent_health.sql'
]
```
Running the command again will verify idempotency (`Migrations skipped (already applied)`).

### 3.3 Private Storage Management
Uploaded raw log files are stored under `storage/workspaces/<workspaceId>/<storageKey>.log`.
To reset local development storage data safely:
```powershell
# Remove all local stored logs (Windows PowerShell)
Remove-Item -Recurse -Force storage/workspaces/*
```

---

## 4. Running the Applications

### 4.1 Start the API Server
In a terminal window:
```powershell
npm.cmd run dev:api
```
The API starts on `http://localhost:4000`.

Verify health and database readiness:
- Health probe: `curl http://localhost:4000/health`
- Readiness probe: `curl http://localhost:4000/ready`

### 4.2 Start the Web Console
In a separate terminal window:
```powershell
npm.cmd run dev:web
```
Access the web dashboard at `http://localhost:3000`.

---

## 5. Running Automated Tests

### 5.1 Run All Tests
```powershell
npm.cmd test
```

### 5.2 Run API Tests Only
```powershell
npm.cmd run test:api
```
Executes Vitest covering health endpoints, database readiness, JSON schema compliance, structured logging redaction, and database integration.

### 5.3 Run Python Tests (Parser & Agent)
```powershell
# Windows PowerShell
python -m pytest services

# Run Agent Tests Only
python -m pytest services/agent/tests

# Run Parser Tests Only
python -m pytest services/parser/tests
```

```bash
# macOS / Linux
pytest services
pytest services/agent/tests
pytest services/parser/tests
```

### 5.4 Run Agent CLI & Diagnostics
```powershell
# Display Agent CLI Help
python -m sentinel_agent.cli --help

# Test simulated log generation
python -m sentinel_agent.cli test-log --message "Oct 27 12:00:00 test-host sshd[100]: Accepted password for root from 10.0.0.1 port 22 ssh2" --file ./test_auth.log
```

### 5.5 Run Parser Self-Check
```powershell
# Windows PowerShell
$env:PYTHONPATH = "services/parser/src"; python -m sentinel_parser.cli --self-check

# macOS / Linux
PYTHONPATH=services/parser/src python -m sentinel_parser.cli --self-check
```

---

## 6. Testing with Synthetic Fixtures

Synthetic test logs reside under `fixtures/linux-auth/`:
- `ssh-success.log`: Normal SSH logins
- `ssh-failure.log`: Failed authentication attempts
- `invalid-user.log`: Probes with nonexistent users
- `brute-force-pattern.log`: High-frequency single-IP failures
- `login-after-failures.log`: Failures followed by a successful login
- `sudo-activity.log`: Sudo execution and password failures
- `malformed-lines.log`: Damaged entries and control characters
- `mixed-activity.log`: Interleaved normal and anomalous records

Parse any fixture using the CLI:
```powershell
$env:PYTHONPATH = "services/parser/src"; python -m sentinel_parser.cli parse fixtures/linux-auth/mixed-activity.log
```

---

## 7. Email Notifications & Health Monitoring

### 7.1 Local Email Development Service
In local environments, NomaanOS Sentinel utilizes a `DevelopmentEmailService` (`apps/api/src/services/email.ts`) that records outbound messages to an in-memory queue and emits structured log statements. This allows end-to-end verification of alert notification flows without requiring third-party SMTP relay credentials.

### 7.2 Workspace Notification Settings & History API
- `GET /api/v1/workspaces/:workspaceId/notifications/settings`: Retrieve current threshold, enabled status, and recipient email list.
- `PATCH /api/v1/workspaces/:workspaceId/notifications/settings`: Update email preferences, recipients, and minimum alert severity (`low`, `medium`, `high`, `critical`).
- `GET /api/v1/workspaces/:workspaceId/notifications/history`: Inspect the persistent notification audit trail and delivery status.
- `POST /api/v1/workspaces/:workspaceId/notifications/test`: Send a simulated test alert notification.

### 7.3 Fleet Health Telemetry API
- `GET /api/v1/integrations/health`: Returns workspace fleet health metrics: total servers, status distribution (`connected`, `degraded`, `inactive`, `disconnected`), 24-hour ingestion rate, and unresolved security threats.

---

## 8. Troubleshooting

- **Database Connection Refused**:
  - Verify container status with `docker compose ps`.
  - Verify that `.env` has `DATABASE_PORT=5433` and `DATABASE_HOST=localhost`.
- **PowerShell Execution Policy**:
  - If `npm` fails due to PowerShell script restrictions, use `npm.cmd` and `npx.cmd`.
- **Port In Use**:
  - If port `5433` is occupied, change `DATABASE_PORT` in `.env` and `docker-compose.yml` to another port (e.g. `5434`).

