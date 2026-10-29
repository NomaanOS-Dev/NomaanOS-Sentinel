# MSP Multi-Client Platform — End-to-End Testing Guide

This guide provides step-by-step instructions to test and verify the **MSP Multi-Client Platform** in NomaanOS Sentinel.

It covers both automated test commands and an interactive walkthrough from A to Z:
- MSP Organization creation and member management
- Onboarding multiple independent client workspaces
- Verifying strict tenant isolation between clients
- Consolidated monitoring (cross-client alerts, fleet health, cases)
- Granular per-client usage tracking & executive reporting
- Web console navigation and seamless client switching

---

## 1. Quick Automated Verification

To verify the entire platform immediately with automated tests:

```powershell
# 1. Run the dedicated MSP Multi-Client integration test suite (Vitest)
npm.cmd run test --workspace=apps/api tests/msp-organizations-and-clients.test.ts

# 2. Run the complete API test suite (28 test files, 149 tests)
npm.cmd run test:api

# 3. Verify Next.js web application build and type checking
npm.cmd run build --workspace=apps/web
```

**Expected Results:**
- All 4 MSP integration tests pass (100% green).
- Full Vitest API suite passes: 28 test files, 149 tests, 0 failures.
- Web build compiles successfully with route `/organizations/[organizationId]`.

---

## 2. Environment & Terminal Setup

Open **three terminal windows** in the project root (`d:\Projects\6-NomaanOS-Sentinel`):

| Terminal | Purpose | Command | URL |
|---|---|---|---|
| **Terminal 1** | **Backend API** | `npm.cmd run dev:api` | `http://localhost:4000` |
| **Terminal 2** | **Web Console** | `npm.cmd run dev:web` | `http://localhost:3000` |
| **Terminal 3** | **Interactive Test Terminal** | PowerShell | Commands below |

### Ensure Database Container is Running
In **Terminal 3**:
```powershell
docker compose up -d database
curl.exe -s http://localhost:4000/ready
```
**Expected Output:** `{"status":"ready","checks":{"database":"ok"}}`

---

## 3. Interactive Step-by-Step Walkthrough (A to Z)

Run all commands in **Terminal 3** (PowerShell).

### Step A: Register MSP Owner Account
Create the primary Managed Service Provider owner account:

```powershell
$OWNER_BODY = @{
  email = "msp_owner@apexsec.com"
  password = "Password123!"
  fullName = "Apex MSP Director"
} | ConvertTo-Json

$OWNER_RES = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/auth/register" `
  -Method Post `
  -ContentType "application/json" `
  -Body $OWNER_BODY `
  -SessionVariable mspOwnerSession

Write-Host "MSP Owner Registered: $($OWNER_RES.user.id)" -ForegroundColor Green
```

---

### Step B: Create MSP Organization
Create the parent MSP Organization (`Apex Managed Security`):

```powershell
$ORG_BODY = @{
  name = "Apex Managed Security"
  slug = "apex-sec"
} | ConvertTo-Json

$ORG_RES = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/organizations" `
  -Method Post `
  -WebSession $mspOwnerSession `
  -ContentType "application/json" `
  -Body $ORG_BODY

$ORG_ID = $ORG_RES.organization.id
Write-Host "MSP Organization Created: $ORG_ID ($($ORG_RES.organization.name))" -ForegroundColor Green
```

---

### Step C: Onboard Multiple Client Workspaces
Create two independent client workspaces under the MSP organization:

```powershell
# 1. Onboard Client Alpha (Acme Corporation)
$CLIENT_A_BODY = @{
  name = "Acme Corporation"
  slug = "acme-corp"
} | ConvertTo-Json

$CLIENT_A = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/organizations/$ORG_ID/clients" `
  -Method Post `
  -WebSession $mspOwnerSession `
  -ContentType "application/json" `
  -Body $CLIENT_A_BODY

$CLIENT_A_ID = $CLIENT_A.client.id
Write-Host "Client Alpha Created: $CLIENT_A_ID" -ForegroundColor Green

# 2. Onboard Client Beta (Wayne Enterprises)
$CLIENT_B_BODY = @{
  name = "Wayne Enterprises"
  slug = "wayne-enterprises"
} | ConvertTo-Json

$CLIENT_B = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/organizations/$ORG_ID/clients" `
  -Method Post `
  -WebSession $mspOwnerSession `
  -ContentType "application/json" `
  -Body $CLIENT_B_BODY

$CLIENT_B_ID = $CLIENT_B.client.id
Write-Host "Client Beta Created: $CLIENT_B_ID" -ForegroundColor Green
```

---

### Step D: Add MSP Staff Members & Enforce RBAC
1. Register a dedicated Security Analyst account:
```powershell
$ANALYST_BODY = @{
  email = "analyst@apexsec.com"
  password = "Password123!"
  fullName = "MSP Senior Analyst"
} | ConvertTo-Json

$ANALYST_RES = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/auth/register" `
  -Method Post `
  -ContentType "application/json" `
  -Body $ANALYST_BODY `
  -SessionVariable analystSession

$ANALYST_ID = $ANALYST_RES.user.id
```

2. Add the analyst to the MSP Organization with role `analyst`:
```powershell
$ADD_MEMBER_BODY = @{
  email = "analyst@apexsec.com"
  role = "analyst"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/v1/organizations/$ORG_ID/members" `
  -Method Post `
  -WebSession $mspOwnerSession `
  -ContentType "application/json" `
  -Body $ADD_MEMBER_BODY

Write-Host "Analyst added to MSP Organization." -ForegroundColor Green
```

3. Verify Analyst Privileges:
The analyst can view clients, investigate alerts, and run AI triage, but **cannot** onboard new clients:
```powershell
try {
  Invoke-RestMethod -Uri "http://localhost:4000/api/v1/organizations/$ORG_ID/clients" `
    -Method Post `
    -WebSession $analystSession `
    -ContentType "application/json" `
    -Body '{"name":"Unauthorized Client"}'
  Write-Host "Error: Analyst should have been blocked!" -ForegroundColor Red
} catch {
  Write-Host "Analyst correctly blocked from creating clients: $($_.Exception.Response.StatusCode)" -ForegroundColor Green
}
```
**Expected Output:** `HTTP 403 Forbidden`

---

### Step E: Test Strict Cross-Client Tenant Isolation
Verify that client users cannot access other client environments or the parent MSP organization:

1. Register a user belonging solely to Client Alpha:
```powershell
$CLIENT_USER_BODY = @{
  email = "user@acme.com"
  password = "Password123!"
  fullName = "Acme Internal Admin"
} | ConvertTo-Json

$CLIENT_USER_RES = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/auth/register" `
  -Method Post `
  -ContentType "application/json" `
  -Body $CLIENT_USER_BODY `
  -SessionVariable clientUserSession

# Add user directly to Client Alpha workspace ONLY
Invoke-RestMethod -Uri "http://localhost:4000/api/v1/workspaces/$CLIENT_A_ID/members" `
  -Method Post `
  -WebSession $mspOwnerSession `
  -ContentType "application/json" `
  -Body '{"email":"user@acme.com","role":"viewer"}'
```

2. Verify Client User is BLOCKED from accessing Client Beta:
```powershell
try {
  Invoke-RestMethod -Uri "http://localhost:4000/api/v1/workspaces/$CLIENT_B_ID/alerts" `
    -Method Get `
    -WebSession $clientUserSession
  Write-Host "Security Vulnerability: Cross-client access was allowed!" -ForegroundColor Red
} catch {
  Write-Host "Strict Tenant Isolation Verified: Access to Client Beta returned $($_.Exception.Response.StatusCode)" -ForegroundColor Green
}
```
**Expected Output:** `HTTP 403 Forbidden`

3. Verify Client User is BLOCKED from accessing MSP Organization endpoints:
```powershell
try {
  Invoke-RestMethod -Uri "http://localhost:4000/api/v1/organizations/$ORG_ID" `
    -Method Get `
    -WebSession $clientUserSession
  Write-Host "Security Vulnerability: Organization access was allowed!" -ForegroundColor Red
} catch {
  Write-Host "MSP Organization Isolation Verified: Access returned $($_.Exception.Response.StatusCode)" -ForegroundColor Green
}
```
**Expected Output:** `HTTP 403 Forbidden`

---

### Step F: Ingest Telemetry & Alerts into Multiple Clients
Generate telemetry in Client Alpha and Client Beta to verify consolidated data aggregation:

```powershell
# Ingest SSH brute-force event into Client Alpha
$EVENT_A = @{
  schema_version = "2020-12"
  source_type = "auth_log"
  source_host = "acme-db-primary"
  event_type = "ssh_login_failure"
  severity = "high"
  occurred_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  username = "root"
  source_ip = "198.51.100.22"
  message = "Failed password for root from 198.51.100.22 port 44222 ssh2"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/v1/events" `
  -Method Post `
  -Headers @{ "x-workspace-id" = "$CLIENT_A_ID" } `
  -WebSession $mspOwnerSession `
  -ContentType "application/json" `
  -Body $EVENT_A

# Ingest event into Client Beta
$EVENT_B = @{
  schema_version = "2020-12"
  source_type = "auth_log"
  source_host = "wayne-app-01"
  event_type = "ssh_login_failure"
  severity = "critical"
  occurred_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  username = "admin"
  source_ip = "203.0.113.88"
  message = "Failed password for admin from 203.0.113.88 port 51234 ssh2"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/v1/events" `
  -Method Post `
  -Headers @{ "x-workspace-id" = "$CLIENT_B_ID" } `
  -WebSession $mspOwnerSession `
  -ContentType "application/json" `
  -Body $EVENT_B

Write-Host "Telemetry ingested into Client Alpha and Client Beta." -ForegroundColor Green
```

---

### Step G: Test Centralized Monitoring Endpoints

#### 1. Consolidated Alerts across All Clients
```powershell
$ALERTS = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/organizations/$ORG_ID/alerts" `
  -Method Get `
  -WebSession $mspOwnerSession

Write-Host "Total Consolidated Alerts: $($ALERTS.total)" -ForegroundColor Cyan
$ALERTS.alerts | Format-Table clientName, title, severity, status
```

#### 2. Filter Alerts by Specific Client
```powershell
$ALERTS_A = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/organizations/$ORG_ID/alerts?client_id=$CLIENT_A_ID" `
  -Method Get `
  -WebSession $mspOwnerSession

Write-Host "Client Alpha Alerts: $($ALERTS_A.total)" -ForegroundColor Cyan
```

#### 3. Consolidated Fleet Health
```powershell
$FLEET = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/organizations/$ORG_ID/fleet" `
  -Method Get `
  -WebSession $mspOwnerSession

Write-Host "Fleet Summary:" -ForegroundColor Cyan
$FLEET.summary | Format-List
```

#### 4. Granular Per-Client Usage Breakdown
```powershell
$USAGE = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/organizations/$ORG_ID/usage" `
  -Method Get `
  -WebSession $mspOwnerSession

Write-Host "Per-Client Usage:" -ForegroundColor Cyan
$USAGE.usage | ForEach-Object {
  [PSCustomObject]@{
    Client = $_.clientName
    TotalEvents = $_.metrics.totalEvents
    Events24h = $_.metrics.eventsLast24h
    Alerts = $_.metrics.totalAlerts
    Cases = $_.metrics.totalCases
    Servers = $_.metrics.totalServers
  }
} | Format-Table
```

#### 5. Consolidated Executive Report
```powershell
$REPORT = Invoke-RestMethod -Uri "http://localhost:4000/api/v1/organizations/$ORG_ID/reports/consolidated" `
  -Method Get `
  -WebSession $mspOwnerSession

Write-Host "Executive Report Totals:" -ForegroundColor Cyan
$REPORT.report.totals | Format-List
```

---

### Step H: Verify MSP Web Console (`apps/web`)

1. Open your browser at [http://localhost:3000](http://localhost:3000).
2. Log in with `msp_owner@apexsec.com` / `Password123!`.
3. You will land on `/workspaces`:
   - Click the **MSP Organizations** tab.
   - You will see the **Apex Managed Security** card showing `2 Clients` and `2 Staff`.
   - Click **Launch MSP Console**.
4. Inside the MSP Console (`/organizations/<orgId>`):
   - **Overview Tab**: Displays total clients, monitored servers, active threats, and client table.
   - **Clients Tab**: Lists Acme Corporation and Wayne Enterprises with direct console links.
   - **Consolidated Alerts Tab**: Displays alerts across all clients with client badge tags and filters.
   - **Fleet Health Tab**: Displays consolidated agent status across all customer infrastructure.
   - **Usage & Reports Tab**: Displays the consumption breakdown table with an **Export Executive Summary (JSON)** download button.
   - **Staff & RBAC Tab**: Displays all staff members with role assignment controls and verified badges.
5. Click **Launch Workspace Console** on *Acme Corporation*:
   - Notice the header badge: `Client of Apex Managed Security` with a link to the MSP Console.
   - Notice the **Client Switcher Dropdown** in the top header: click it to jump directly between Acme Corporation and Wayne Enterprises without losing investigation context!

