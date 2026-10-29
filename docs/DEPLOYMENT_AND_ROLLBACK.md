# NomaanOS Sentinel — Staging Deployment and Rollback Guidelines

This document details the production and staging deployment processes, automated verification procedures, and rollback strategies for NomaanOS Sentinel.

---

## 1. Pre-Deployment Environment Audit

Before triggering a release, ensure all required environment variables are set in your deployment manager or container secret store:

| Variable | Description | Requirement |
|---|---|---|
| `NODE_ENV` | `production` or `staging` | Required |
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `SESSION_SECRET` | 32+ character high-entropy session key | Required |
| `COOKIE_SECURE` | Set to `true` when behind TLS reverse proxy | Required in production |
| `RAZORPAY_KEY_ID` | Razorpay Merchant Key ID (`rzp_test_...` or `rzp_live_...`) | Required for billing |
| `RAZORPAY_KEY_SECRET` | Razorpay Secret Key | Required for billing |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook verification secret from Razorpay dashboard | Required for webhooks |
| `OUTBOUND_WEBHOOKS_MAX_RETRIES` | Max delivery retries (default: `3`) | Optional |
| `OUTBOUND_WEBHOOKS_TIMEOUT_MS` | Per-request timeout in milliseconds (default: `5000`) | Optional |
| `OUTBOUND_WEBHOOKS_ALLOW_HTTP` | Force `false` in production (allows HTTPS only) | Required (`false`) |

---

## 2. Step-by-Step Staging & Production Deployment

### Step 1: Pre-Deployment Automated Checks
Ensure all automated CI checks have passed on the release branch:
- Backend Vitest API suite (100% pass)
- Python Parser & Agent test suites (100% pass)
- Next.js web application production build (`npm run test:web`)
- Dependency audit (`npm audit --audit-level=high`) and secret scanning

### Step 2: Database Migration Execution
Sentinel uses forward-only, idempotent versioned database migrations:
```bash
# Execute migrations before routing new container traffic
npm run db:migrate
```
*Note: All migrations use `IF NOT EXISTS` and avoid table locks. Forward-compatible schema changes ensure zero-downtime during rolling restarts.*

### Step 3: Rolling or Blue-Green Application Deployment
Deploy new container versions:
```bash
# Docker Compose environment:
docker compose build api web
docker compose up -d --no-deps api web
```

### Step 4: Health and Readiness Verification
Poll endpoints to confirm traffic readiness:
```bash
# 1. API Liveness
curl -f http://127.0.0.1:4000/health
# Expected: HTTP 200 {"status":"ok","timestamp":"..."}

# 2. Database and Component Readiness
curl -f http://127.0.0.1:4000/ready
# Expected: HTTP 200 {"status":"ok","database":"connected"}

# 3. Web Console Frontend
curl -f -I http://127.0.0.1:3000
# Expected: HTTP 200 / 307
```

---

## 3. Commercial Feature Post-Deploy Verification Checklist

Verify newly deployed commercial modules in staging:

- [ ] **Plan Catalog & Quotas**:
  ```bash
  curl -s http://127.0.0.1:4000/api/v1/billing/plans | jq .
  ```
  Ensure all 4 tiers (`free`, `starter`, `pro`, `msp`) are present with accurate limits.
- [ ] **Subscription Quota Gate (HTTP 402)**:
  Create an integration on a Free workspace exceeding 1 integration; confirm HTTP 402 `QUOTA_EXCEEDED` is returned.
- [ ] **Razorpay Checkout & Webhook**:
  Create an order via `POST /api/v1/billing/orders` with plan `starter`. Send a simulated webhook payload with valid `X-Razorpay-Signature`; confirm subscription status updates to `active`.
- [ ] **SSRF Protection on Webhooks**:
  Attempt to register an outbound webhook pointing to `http://169.254.169.254/latest/meta-data/` or `http://localhost:5432`; confirm immediate rejection with HTTP 400 `SSRF_DESTINATION_REJECTED`.
- [ ] **Outbound Webhook Delivery**:
  Register a valid HTTPS test endpoint (e.g., webhook.site). Dispatch a test ping via `POST /api/v1/workspaces/:id/webhooks/:webhookId/test`; confirm HMAC signature headers `X-Sentinel-Signature` and `X-Sentinel-Timestamp` are recorded.
- [ ] **Tenant Isolation**:
  Confirm that members of Workspace A receive HTTP 403 / 404 when querying Webhooks or Subscriptions belonging to Workspace B.

---

## 4. Rollback Strategies

### 4.1 Application Container Rollback
If application health checks fail or severe runtime errors emerge post-deployment:
```bash
# Revert container image tags to prior stable release
docker tag nomaanos-api:previous-stable nomaanos-api:latest
docker tag nomaanos-web:previous-stable nomaanos-web:latest
docker compose up -d --no-deps api web
```

### 4.2 Database Rollback Strategy: Forward-Fix vs Down Migrations
- **Default Sentinel Policy: Forward-Fixing**:
  Sentinel migrations are designed to be additive and backward-compatible (e.g. adding nullable columns or new isolated tables such as `subscriptions` and `workspace_webhooks`).
  Rolling back the API container to the previous release will continue functioning normally because old code ignores newly added columns or tables.
- **Critical Down-Migration (Emergency Only)**:
  If an irreversible defect occurs in an applied migration, execute a reverse patch migration:
  ```sql
  -- Rollback 012 (Outbound Webhooks):
  DROP TABLE IF EXISTS webhook_deliveries CASCADE;
  DROP TABLE IF EXISTS workspace_webhooks CASCADE;
  DELETE FROM schema_migrations WHERE name = '012_create_outbound_webhooks.sql';

  -- Rollback 011 (Billing & Subscriptions):
  DROP TABLE IF EXISTS billing_payments CASCADE;
  DROP TABLE IF EXISTS billing_webhook_events CASCADE;
  DROP TABLE IF EXISTS subscriptions CASCADE;
  DELETE FROM schema_migrations WHERE name = '011_create_subscriptions_and_billing.sql';
  ```
- **Disaster Point-In-Time Restoration**:
  If data corruption occurs, restore the database from the pre-deployment snapshot following [BACKUP_AND_RECOVERY.md](file:///d:/Projects/6-NomaanOS-Sentinel/docs/BACKUP_AND_RECOVERY.md).

