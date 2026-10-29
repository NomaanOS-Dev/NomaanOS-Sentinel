# NomaanOS Sentinel

> **AI-Assisted Cybersecurity Threat Detection and Response Platform**  
> Tailored for small businesses, IT consultants, and Managed Service Providers (MSPs).

---

## Overview

NomaanOS Sentinel delivers high-fidelity security monitoring by combining deterministic threat detection with evidence-backed AI investigations. The platform normalizes diverse infrastructure telemetry into a canonical schema, evaluates versioned detection rules with cryptographic traceability, and isolates multi-tenant workspaces for MSP environments.

---

## Current Implementation Status: Foundation, Auth & Ingestion Ready

The core development foundation, multi-tenant authentication system, and log-ingestion pipeline have been established and verified:
- [x] **Monorepo Architecture**: Clean separation between Web Console (`apps/web`), Express API (`apps/api`), Parser Engine (`services/parser`), Database (`database/`), and Fixtures (`fixtures/`).
- [x] **PostgreSQL & Migrations**: PostgreSQL 16 running via Docker Compose with health checks and version-tracked SQL migrations (`001_create_security_events.sql`, `002_create_auth_and_workspaces.sql`, `003_create_datasets_and_jobs.sql`).
- [x] **Authentication & Session Security**: Secure registration, email/password sign-in, SHA-256 server-managed sessions stored in PostgreSQL, HttpOnly/SameSite session cookies, email verification, and password reset flows with cryptographic token hashing.
- [x] **Multi-Tenant Workspaces & RBAC**: Tenant workspaces with creator-ownership, invitation/member management, and hierarchical Role-Based Access Control (`owner` > `admin` > `analyst` > `viewer`) enforcing query isolation against IDOR.
- [x] **Secure Log Upload & Storage**: Bounded streaming multipart upload for `.log` and `.txt` authentication logs (5 MiB, 50,000 lines, 16 KiB per line limits), private workspace-scoped storage with opaque keys, duplicate SHA-256 detection, and content validation.
- [x] **PostgreSQL Background Worker & Parser Engine**: Atomic queue claiming using `FOR UPDATE SKIP LOCKED`, durable lease recovery, Python `sentinel_parser` child process execution, canonical schema enforcement, and transactional batch event persistence.
- [x] **Canonical Security Event Schema**: JSON Schema Draft 2020-12 definition (`database/schema/security-event.schema.json`) with full TypeScript and Python validation.
- [x] **API Health & Observability**: Liveness (`/health`) and live PostgreSQL readiness (`/ready`) probes, correlation IDs, and structured logging with automated credential redaction.
- [x] **Web Console UI**: Modern Next.js 14 / Tailwind CSS dashboard with drag-and-drop log ingestion, dataset lifecycle monitoring, background status polling, team administration, and workspace switcher.
- [x] **Comprehensive Automated Tests**: 62 Vitest tests for the API (covering ingestion, validation, parser integration, queue, auth, sessions, RBAC, tenant isolation) and 20 Pytest tests for the parser with 100% passing results.

---

## Architecture Topology

| Service | Technology | Port / Location | Endpoints & Health Check |
|---|---|---|---|
| **Web Console** | Next.js 14 / React 18 | `http://localhost:3000` | `/login`, `/register`, `/workspaces`, `/workspaces/:id` |
| **API Server** | Node.js / Express / TypeScript | `http://localhost:4000` | `GET /health`, `GET /ready`<br>`/api/v1/auth/*`<br>`/api/v1/workspaces/*` |
| **Database** | PostgreSQL 16 Alpine | `127.0.0.1:5433` (Docker) | `pg_isready` (Docker Healthcheck) |
| **Parser Package** | Python 3.12 (`sentinel_parser`) | `services/parser` | `python -m sentinel_parser.cli --self-check` |
| **Linux Monitoring Agent** | Python 3.12 (`sentinel_agent`) | `services/agent` | `sentinel-agent status` / systemd |

---

## Authentication & Workspace Endpoints

### Authentication (`/api/v1/auth`)
- `POST /register`: Register new user, initial workspace, and session.
- `POST /login`: Authenticate with email/password, issue HttpOnly session cookie.
- `GET /me`: Return current user profile, active session, and verified status.
- `POST /logout`: Invalidate current session and clear cookie.
- `POST /verify-email`: Confirm email token (single-use, 24h lifetime).
- `POST /resend-verification`: Resend verification email (rate-limited).
- `POST /forgot-password`: Request single-use password reset link (anti-enumeration).
- `POST /reset-password`: Apply new password, invalidate reset token, revoke all active sessions.

### Workspaces & RBAC (`/api/v1/workspaces`)
- `POST /`: Create a new workspace (creator automatically becomes `owner`).
- `GET /`: List all workspaces the authenticated user belongs to.
- `GET /:id`: Fetch workspace details (requires membership).
- `GET /:id/members`: List workspace members and roles (`viewer+`).
- `POST /:id/members`: Add a user by email with assigned role (`admin+`).
- `PATCH /:id/members/:userId`: Change member role (`admin+`, cannot escalate above self).
- `DELETE /:id/members/:userId`: Remove member (`admin+`, protected against removing sole owner).
- `GET /:id/events`: Workspace-isolated security events (`viewer+`).
- `POST /:id/datasets`: Bounded multipart upload for authentication logs (`analyst+`, requires email verification).
- `GET /:id/datasets`: List workspace datasets with status and parsing metrics (`viewer+`).
- `GET /:id/datasets/:datasetId`: Retrieve single dataset details and error states (`viewer+`).
- `POST /:id/datasets/:datasetId/retry`: Retry failed background processing job (`admin+`).
- `GET /:id/datasets/:datasetId/raw`: Stream original log file from private storage (`analyst+`).

### Role-Based Access Control (RBAC) Matrix

| Action | Viewer | Analyst | Admin | Owner |
|---|:---:|:---:|:---:|:---:|
| View Workspace Metadata | Yes | Yes | Yes | Yes |
| View Workspace Members | Yes | Yes | Yes | Yes |
| View Security Events | Yes | Yes | Yes | Yes |
| View Datasets & Status | Yes | Yes | Yes | Yes |
| Upload Log Telemetry | - | Yes | Yes | Yes |
| Download Raw Logs | - | Yes | Yes | Yes |
| Add Members | - | - | Yes | Yes |
| Update Member Roles | - | - | Yes | Yes |
| Remove Members | - | - | Yes | Yes |
| Retry Failed Datasets | - | - | Yes | Yes |
| Update Workspace Settings | - | - | - | Yes |
| Delete Workspace | - | - | - | Yes |

---

## Supported Upload Formats & Ingestion Limits

- **File Types**: Plain-text Linux authentication telemetry (`.log`, `.txt`). Examples: `/var/log/auth.log`, `/var/log/secure`.
- **Maximum File Size**: 5 MiB (5,242,880 bytes).
- **Maximum Non-Empty Log Lines**: 50,000 lines.
- **Maximum Line Length**: 16 KiB (16,384 bytes).
- **Processing Timeout**: 30 seconds per dataset.
- **Content Validation**: Strict UTF-8 validation. Null bytes (`\0`), control characters, and binary content are immediately rejected before parsing.
- **Private Storage**: Uploaded logs are stored in workspace-scoped directories outside the web root (`storage/workspaces/<workspaceId>/<storageKey>.log`) using server-generated opaque UUIDs.
- **Duplicate Prevention**: SHA-256 digests identify identical uploads. Re-uploading an identical completed or in-progress log within the same workspace returns HTTP 409 Conflict without duplicating processing.

---

## Quickstart Guide

### 1. Prerequisites
- **Node.js**: v20+ or v24+
- **Python**: 3.10+
- **Docker & Docker Compose**: Docker 26+
- **Git**: 2.40+

### 2. Configure Environment
```bash
# Copy template
cp .env.example .env
```
*(On Windows: `Copy-Item .env.example .env`)*

### 3. Install Dependencies
```bash
# Install Node dependencies
npm.cmd install    # Windows
npm install        # macOS / Linux

# Install Python test tools
python -m pip install pytest jsonschema
```

### 4. Start Database & Run Migrations
```bash
# Start PostgreSQL container
docker compose up -d database

# Apply database migrations
npm.cmd run db:migrate   # Windows
npm run db:migrate       # macOS / Linux
```

### 5. Start Application Services
```bash
# Terminal 1: API Server (port 4000)
npm.cmd run dev:api

# Terminal 2: Web Console (port 3000)
npm.cmd run dev:web
```

---

## Automated Verification & Test Commands

Run the complete test suite:
```bash
# Run API unit & integration tests
npm.cmd run test:api

# Run Python parser tests
# (Windows)
$env:PYTHONPATH = "services/parser/src"; python -m pytest services/parser/tests
# (macOS/Linux)
PYTHONPATH=services/parser/src pytest services/parser/tests

# Run Python parser self-check
# (Windows)
$env:PYTHONPATH = "services/parser/src"; python -m sentinel_parser.cli --self-check
```

---

## Security & Threat Model

See [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) for full threat analysis. Key tenets:
- **Untrusted Telemetry**: No string extracted from log files or agent streams is ever evaluated or passed to a shell.
- **Redaction by Default**: Pino structured logger automatically redacts `authorization`, `password`, `cookie`, and `database_url`.
- **Advisory AI Boundaries**: AI produces hypotheses and safe suggestions only; no autonomous remediation actions are permitted.
- **Data Boundary Protection**: Every stored event is bound to a `tenant_id` for upcoming MSP workspace separation.

---

## Synthetic Fixture Library

Located at `fixtures/linux-auth/`:
- `ssh-success.log` — Legitimate publickey and password sessions
- `ssh-failure.log` — Standard authentication failures
- `invalid-user.log` — Probing nonexistent usernames
- `brute-force-pattern.log` — High-velocity attempts from single source IP
- `login-after-failures.log` — Failures followed by successful login
- `session-lifecycle.log` — Session open/close audit trail
- `sudo-activity.log` — Privilege escalation executions and failures
- `malformed-lines.log` — Damaged, truncated, and binary entries (tested for non-crashing robustness)
- `mixed-activity.log` — Complex interleaved telemetry

---

## Known Limitations & Planned Capabilities

1. **Detection Rule Engine**: The Python parser extracts structured events with raw line references; versioned correlation rules (brute-force, after-failure login) will be connected in the detection engine milestone.
2. **Continuous Monitoring Agent**: Ingestion currently accepts file uploads and API calls; the lightweight Linux endpoint agent will be added in the agent milestone.
3. **AI-Assisted Investigation Agent**: Incident summarization, anomaly explanation, and guided investigation hypotheses will interface with local/cloud LLMs in the AI investigation milestone.

---

## Documentation

- [Repository Audit](docs/REPOSITORY-AUDIT.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [Threat Model](docs/THREAT-MODEL.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [Linux Monitoring Agent Guide](docs/LINUX-AGENT.md)
- [Synthetic Fixtures Catalog](fixtures/linux-auth/README.md)

