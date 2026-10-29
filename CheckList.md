# Phase 0 — Product foundation and development setup
Before building customer-facing functionality
Confirm the initial buyer and first security use case
[ ] Choose the first supported Linux authentication-log format
[ ] Create the Git repository and issue tracker
[ ] Write architecture and threat-model documents
[ ] Set up local development with Docker Compose
[ ] Create development, staging and production configurations
[ ] Create environment-variable templates and secret-handling rules
[ ] Define the normalized security-event schema
[ ] Create synthetic log files and expected detection results
[ ] Document supported formats, limitations and data retention
[ ] Create automated formatting, linting and type-checking
[ ] Set up database migrations and application health checks

# Phase 1 — MVP: Upload and investigate
This is the first complete product we should make usable by real pilot customers.

A. Accounts and workspace
[ ] Registration and sign-in
[ ] Email verification and password reset
[ ] Session expiration and secure cookies
[ ] Workspace creation and management
[ ] Owner/admin/analyst/viewer permissions
[ ] Server-side workspace authorization
[ ] Basic member management

B. File uploads and processing
[ ] Drag-and-drop and file picker
[ ] Supported-format documentation before upload
[ ] File size, content, encoding and line-count validation
[ ] Private storage for uploaded logs
[ ] Upload progress and processing status
[ ] Queued, parsing, detecting, complete and failed states
[ ] Parsing statistics: valid, skipped and malformed lines
[ ] Safe retry handling and duplicate prevention
[ ] Dataset deletion and retention enforcement

C. Log parsing and normalization
[ ] Initial Linux auth.log/secure-style authentication parsing
[ ] Extract timestamps, hosts, process IDs and usernames where available
[ ] Extract source IP, event type and outcome where available
[ ] Normalize timestamps to UTC while preserving uncertainty
[ ] Retain source-line references
[ ] Record parser version and dataset hash
[ ] Count and explain malformed or unknown records
[ ] Unit tests for timezone and malformed input

D. Detection engine
[ ] Repeated failed authentication detection
[ ] Successful login after repeated failures
[ ] Supported privileged-account activity detection
[ ] New authentication source detection when enough history exists
[ ] Parser-anomaly detection when justified
[ ] Versioned detection rules and configurable thresholds
[ ] Severity rationale and detection explanations
[ ] Alert fingerprinting and deduplication
[ ] Supporting event IDs for every alert
[ ] Positive, negative, boundary and regression tests
[ ] False-positive feedback and reasons

E. Dashboard and investigation
[ ] Overview dashboard and recent alerts
[ ] Alert counts by severity and status
[ ] Alert detail with rule, time window and evidence
[ ] Event explorer with pagination
[ ] Search by host, username, IP, date and event type
[ ] Filters by severity, rule, host and status
[ ] Nearby-event investigation
[ ] Investigation cases and case notes
[ ] Case status: open, investigating, resolved or false positive
[ ] Assignment where supported
[ ] Case history and timestamps
[ ] PDF or other documented report export

F. AI investigation assistant
[ ] Plain-language explanation of an alert
[ ] Separate observed facts, hypotheses and unknowns
[ ] Evidence-linked event IDs
[ ] Suggested safe, read-only investigation checks
[ ] Client-facing report drafts
[ ] Strict output schema validation
[ ] Reject or flag nonexistent evidence IDs
[ ] Redact secrets and minimize evidence sent to AI
[ ] Prompt-injection tests for hostile log content
[ ] Provider adapter, timeouts, rate limits and usage metering

G. SaaS administration
[ ] Synthetic demo dataset and demo workflow
[ ] Audit history for sensitive actions
[ ] Configurable retention defaults
[ ] Usage quotas for uploads, events, AI and retention
[ ] Clear processing errors and recoverable failures
[ ] Workspace-scoped search and access
[ ] Account and workspace settings
[ ] Privacy notice and deletion controls
[ ] Usage and operational cost metrics


# Phase 2 — Continuous Linux monitoring
Turn the product from a file-analysis tool into a monitoring service
[x] Lightweight Linux monitoring agent
[x] Documented installation and uninstallation instructions
[x] Supported Linux distribution and version matrix
[x] One-time, expiring enrollment tokens
[x] Asset registration and server identity
[x] Per-agent credentials and secure credential storage
[x] TLS-protected event ingestion
[x] Agent credential rotation and revocation
[x] Collection of explicitly selected authentication/security logs
[x] Bounded local queue during network outages
[x] Retry with backoff and duplicate-event prevention
[x] Event sequence IDs and replay protection where applicable
[x] Agent heartbeat and last-seen status
[x] Agent version, health and collection status
[x] Asset inventory and enrollment status
[x] Alert notifications by email
[x] Configurable alert thresholds and quieting
[x] Alert deduplication
[x] Delivery-lag and failed-batch monitoring
[x] Agent update strategy and integrity checks
[x] Remote uninstall/cleanup instructions and credential revocation
[x] Monitoring-service health dashboard
[x] Documented minimum permissions and privacy impact

# Phase 3 — MSP multi-client platform
This is where NomaanOS Sentinel becomes useful to a company managing many customer environments.
[x] MSP organization account
[x] Create and manage separate client workspaces
[x] Switch between clients from a centralized console
[x] Strict isolation of one client's data from another
[x] MSP owner and administrator roles
[x] Analyst and read-only viewer roles
[x] Optional client-side viewer accounts
[x] Client-scoped assets and agent enrollment
[x] Central alert overview across authorized clients
[x] Client-specific alert and severity views
[x] Client-specific investigation cases
[ ] Client-specific notes and reports
[x] Consolidated reporting for the MSP
[x] Usage and event-volume breakdown per client
[x] Client-specific access permissions
[ ] Client-level retention configuration when supported
[ ] Saved filters and investigation templates
[ ] Scheduled security reports
[x] Notification preferences per workspace
[ ] Signed outbound webhooks
[ ] Webhook delivery history, retries and secret rotation
[ ] Subscription plans and server-side quota enforcement
[ ] Billing, invoices/receipts and cancellation
[ ] Account and data export
[x] Auditable MSP administrative actions
[x] Tests proving cross-client data isolation

# Phase 4 — Advanced commercial and enterprise features
These are recommended future additions, not all features promised by the uploaded plan. Prioritize them only when customers ask for them and the core platform is reliable.
Advanced feature backlog

0/33

Additional integrations
[ ] Windows event-log ingestion
[ ] Selected cloud audit-log integrations
[ ] Ticketing integration with systems such as Jira or ServiceNow
[ ] Chat and alert destinations such as Slack or Microsoft Teams
[ ] SIEM export and standardized event forwarding
[ ] Public API and API key management
[ ] Integration catalog and setup guides


Advanced detection
[ ] Correlation across hosts and time windows
[ ] Custom rules and customer-specific thresholds
[ ] Allowlisting and suppression controls
[ ] Historical baselines and anomaly detection
[ ] Threat-intelligence enrichment where justified
[ ] Detection rule testing and controlled deployment
[ ] Detection quality and false-positive dashboards


Enterprise administration
[ ] Single sign-on (SSO)
[ ] Multi-factor authentication enforcement
[ ] Granular custom roles
[ ] Custom retention and data-residency options
[ ] Enterprise audit exports
[ ] Formal uptime and support commitments when operationally justified
[ ] Security assessments and a vulnerability disclosure process


Scale and reliability
[ ] High-availability deployment
[ ] Queue scaling and back-pressure
[ ] Database partitioning when needed
[ ] Disaster recovery and tested restore procedures
[ ] Service-level monitoring and incident runbooks
[ ] Customer-facing service status
[ ] Capacity and cost forecasting
[ ] Controlled release, rollback and agent-update systems


Potential advanced response capabilities
[ ] Human-approved remediation workflow
[ ] Integrations with approved response tools
[ ] Explicit approvals, audit trails and rollback controls
[ ] Restricted actions with customer-defined permissions


# Day 1 -- Repository, architecture and development environment
> Goal: establish the foundation without breaking or unnecessarily replacing any existing work.

Inspect the current repository and existing code.
[x] Confirm the frontend, backend, parser and database structure.
[x] Set up Git, .gitignore and .env.example.
[x] Set up Docker Compose for local development.
[x] Configure PostgreSQL and database migrations.
[x] Add health-check endpoints and structured application logs.
[x] Define the normalized security-event schema.
[x] Create synthetic Linux authentication logs for testing.
[x] Document the architecture and initial threat model.

# Day 2 -- Authentication, users and workspaces
> Goal: establish the identity and authorization system that every other feature will use.

[x] Registration and sign-in.
[ ] Email verification and password reset.
[ ] Secure sessions, logout and expiration.
[ ] Create a workspace for the user.
[ ] Store workspace memberships.
[ ] Implement owner, admin, analyst and viewer permissions.
[ ] Enforce workspace authorization in backend routes.
[ ] Add tests for unauthorized and cross-workspace requests.