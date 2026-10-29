# NomaanOS Sentinel — Database Backup and Disaster Recovery Runbook

This runbook defines the operational procedures for PostgreSQL database backups, point-in-time restores, data integrity verification, and disaster recovery for NomaanOS Sentinel environments.

---

## 1. Environment Architecture

- **Database Engine**: PostgreSQL 16+
- **Default Port**: `5433` (Dockerized local/staging) / `5432` (Production managed instance)
- **Database Name**: `nomaanos_sentinel`
- **Default Development User**: `sentinel_dev`
- **Container Name (Docker)**: `nomaanos-sentinel-postgres` (defined in `docker-compose.yml`)

---

## 2. Backup Procedures

### 2.1 Full Custom-Format Backup (`pg_dump` with Compression)

The custom archive format (`-Fc`) is compressed, supports multi-threaded restore (`pg_restore -j`), and allows selective object restoration.

#### Standard Direct Host Command:
```bash
pg_dump \
  --host=127.0.0.1 \
  --port=5433 \
  --username=sentinel_dev \
  --dbname=nomaanos_sentinel \
  --format=custom \
  --compress=9 \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --file="sentinel_backup_$(date +%Y%m%d_%H%M%S).dump"
```

#### Docker Compose Environment Command (Recommended for Local/Staging):
```bash
docker exec -e PGPASSWORD=sentinel_local_dev_secret_2026 \
  nomaanos-sentinel-postgres \
  pg_dump \
  -U sentinel_dev \
  -d nomaanos_sentinel \
  -Fc \
  -Z 9 \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  > "./backups/sentinel_backup_$(date +%Y%m%d_%H%M%S).dump"
```

### 2.2 Plain SQL Dump (Human-Readable / Migration Inspection)
```bash
docker exec -e PGPASSWORD=sentinel_local_dev_secret_2026 \
  nomaanos-sentinel-postgres \
  pg_dump \
  -U sentinel_dev \
  -d nomaanos_sentinel \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  | gzip -9 > "./backups/sentinel_dump_$(date +%Y%m%d_%H%M%S).sql.gz"
```

---

## 3. Restore Procedures

### 3.1 Disaster Recovery Restore (Custom-Format `.dump`)

#### Step 1: Terminate Existing Client Connections (Prevent Locks)
```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'nomaanos_sentinel' AND pid <> pg_backend_pid();
```

#### Step 2: Execute `pg_restore`
```bash
# Restore via Docker container
cat "./backups/sentinel_backup_20261028_120000.dump" | \
docker exec -i -e PGPASSWORD=sentinel_local_dev_secret_2026 \
  nomaanos-sentinel-postgres \
  pg_restore \
  -U sentinel_dev \
  -d nomaanos_sentinel \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --exit-on-error
```

#### Direct Host Restore:
```bash
pg_restore \
  --host=127.0.0.1 \
  --port=5433 \
  --username=sentinel_dev \
  --dbname=nomaanos_sentinel \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --single-transaction \
  "./backups/sentinel_backup_20261028_120000.dump"
```

### 3.2 Plain SQL Restore (`.sql` or `.sql.gz`)
```bash
gunzip -c "./backups/sentinel_dump_20261028_120000.sql.gz" | \
docker exec -i -e PGPASSWORD=sentinel_local_dev_secret_2026 \
  nomaanos-sentinel-postgres \
  psql -U sentinel_dev -d nomaanos_sentinel --single-transaction
```

---

## 4. Verification Procedure

Following any restore, operators must execute the automated verification script to confirm complete schema and tenant recovery:

### Verification SQL Check:
```sql
-- 1. Verify schema migrations table and version count
SELECT COUNT(*) AS total_migrations, MAX(name) AS latest_migration 
FROM schema_migrations;
-- Expected: at least 12 migrations (up to 012_create_outbound_webhooks.sql)

-- 2. Verify all core tables exist and have records
SELECT
  (SELECT COUNT(*) FROM users) AS users_count,
  (SELECT COUNT(*) FROM workspaces) AS workspaces_count,
  (SELECT COUNT(*) FROM organizations) AS orgs_count,
  (SELECT COUNT(*) FROM subscriptions) AS subscriptions_count,
  (SELECT COUNT(*) FROM security_events) AS events_count,
  (SELECT COUNT(*) FROM alerts) AS alerts_count,
  (SELECT COUNT(*) FROM cases) AS cases_count,
  (SELECT COUNT(*) FROM workspace_webhooks) AS webhooks_count;

-- 3. Verify foreign key integrity
SELECT conname, confrelid::regclass AS referenced_table, conrelid::regclass AS table_name
FROM pg_constraint
WHERE contype = 'f'
  AND connamespace = 'public'::regnamespace;
```

### Automated API Readiness Check:
```bash
curl -f http://localhost:4000/ready
# Expected: HTTP 200 {"status":"ok","database":"connected"}
```

---

## 5. Retention & Security Policies

1. **Snapshot Cadence**:
   - **Continuous**: PostgreSQL Write-Ahead Logging (WAL) archiving for Point-In-Time Recovery (PITR) up to 7 days.
   - **Daily Full**: Automated snapshot executed daily at 02:00 UTC, retained for 30 days.
   - **Weekly Archive**: Executed Sundays at 03:00 UTC, retained for 12 months in cold storage.
2. **Encryption at Rest**:
   - Backup files must be encrypted before upload to cloud object storage:
     ```bash
     gpg --symmetric --cipher-algo AES256 -o sentinel_backup.dump.gpg sentinel_backup.dump
     ```
   - S3/GCS buckets must enforce AWS KMS or GCP Cloud KMS customer-managed key encryption and block public access.
3. **Restoration Drills**:
   - Automated sandbox restoration drill runs every 30 days to test backup recovery time objectives (RTO < 30 mins) and recovery point objectives (RPO < 1 hour).

