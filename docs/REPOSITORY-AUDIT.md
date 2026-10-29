# Repository Audit: NomaanOS Sentinel

**Audit Date:** 2026-10-24  
**Project:** NomaanOS Sentinel  
**Target Purpose:** AI-assisted cybersecurity threat detection and response platform tailored for IT consultants, small businesses, and Managed Service Providers (MSPs).

---

## 1. Initial State & Discovered Environment

### 1.1 Directory & File Layout
Prior to initialization, the project root `D:\Projects\6-NomaanOS-Sentinel` contained only two files:
- `features.md`: Comprehensive product requirements and plain-language specification covering Log Ingestion, Threat Detection & Alerts, AI & Investigation Management, Security/Privacy, Analyst Workflows, and Multi-tenant MSP Architecture.
- `PLAN.MD`: Comprehensive 15-day implementation roadmap and acceptance criteria reference.

No git repository was initialized initially (`fatal: not a git repository`).

### 1.2 Runtime Environment & Tooling
An inspection of the local host environment revealed:
- **Node.js**: `v24.21.0` installed.
- **npm**: `v11.19.0` (accessible via `npm.cmd` due to Windows PowerShell script execution policy restricting `.ps1`).
- **Python**: Python 3.12.10 installed under `C:\Users\NK-WorkStation\AppData\Local\Programs\Python\Python312\python.exe` with `pip 25.0.1` enabled; WSL2 Ubuntu available with Python 3.14.4.
- **Docker**: Docker CLI `29.8.2`, Docker Compose `v5.6.0`, and Docker Desktop running via WSL2 backend.
- **Git**: `git version 2.56.0.windows.2` installed. Git repository initialized on branch `main`.

### 1.3 Active Services & Port Inspection
- Docker daemon is active.
- Port inspection revealed another project (`4-micro-vendor-fraud-detection-db-1`) currently binding host port `5432`.
- **Decision**: To avoid port collisions and respect existing running workloads, NomaanOS Sentinel's local PostgreSQL service will default to host port `5433` (configurable via `DATABASE_PORT` in `.env`), while maintaining standard internal container port `5432`.

---

## 2. Existing Working Features & Preserved Files

- **Preserved**: `features.md` — Core platform specifications, workflows, and MSP requirements.
- **Preserved**: `PLAN.MD` — Reference roadmap and detailed execution guidance.
- Neither file was overwritten, deleted, or altered.

---

## 3. Missing Foundation Components

The following foundational building blocks were absent and are required:
1. **Repository Layout**:
   - Monorepo workspace structure with `apps/web` (Next.js frontend), `apps/api` (Express/Node.js API), and `services/parser` (Python security parser package).
2. **Configuration & Git Hygiene**:
   - `.gitignore` tailored for Node, Next.js, Python, PostgreSQL volumes, logs, and sensitive `.env` files.
   - `.env.example` documenting all configuration keys with safe placeholder values.
3. **Database & Migrations**:
   - PostgreSQL service in `docker-compose.yml` with health checks and persistent volume storage.
   - Database migration tooling and initial SQL migration defining the canonical `security_events` table and foundational indexes.
   - Canonical JSON Schema (`database/schema/security-event.schema.json`) adhering to Draft 2020-12.
4. **API Application**:
   - Express TypeScript API with structured logging (correlation IDs, method, duration, redaction of sensitive headers and passwords).
   - Health-check endpoints: `GET /health` (liveness) and `GET /ready` (database connectivity probe).
5. **Python Parser Package**:
   - `services/parser` package (`sentinel_parser`) with isolated environment, schema mapping, and parser interface.
   - Synthetic Linux authentication fixtures (`fixtures/linux-auth/`) covering SSH login, failures, invalid users, privilege escalation, and malformed entries.
6. **Documentation & Quality Gates**:
   - `docs/ARCHITECTURE.md`, `docs/THREAT-MODEL.md`, `docs/DEVELOPMENT.md`, and updated root `README.md`.
   - Automated test suite validating API health, database readiness, schema compliance, Python parser logic, and fixture handling.

---

## 4. Potential Compatibility Issues & Risks

1. **PowerShell Script Execution Policy**:
   - Standard `npm` command may fail if called directly as `npm` when PowerShell disables unsigned `.ps1` execution.
   - *Mitigation*: Use `npm.cmd` and `npx.cmd` in scripts and run commands.
2. **PostgreSQL Port Conflict**:
   - Host port `5432` is bound by a pre-existing container.
   - *Mitigation*: Use host port `5433` for local development by default, while allowing override via `DATABASE_PORT`.
3. **Log Content Untrusted Input**:
   - Log files can contain malicious shell payloads, terminal control characters, or prompt injection strings.
   - *Mitigation*: Strict JSON schema validation, bounded message lengths, no direct shell execution or arbitrary eval.

---

## 5. Implementation Roadmap for Foundation

1. Establish Git hygiene (`.gitignore`) and environment specification (`.env.example`).
2. Configure Docker Compose for PostgreSQL.
3. Define the normalized security-event JSON schema and SQL migrations.
4. Build the Express TypeScript API with structured logging, health checks, and database connection readiness.
5. Create the Next.js React frontend scaffold in `apps/web`.
6. Implement the Python parser package (`sentinel_parser`) with normalization logic and synthetic fixtures.
7. Write comprehensive automated tests across all components.
8. Deliver architecture and threat model documentation.

