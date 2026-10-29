# NomaanOS Sentinel — Complete 15-Day Plan Validation

Maine tumhara complete project plan, 15-day roadmap, feature checklist, Linux monitoring requirements, MSP functionality, security requirements aur SaaS business model review kiya hai.

**Mera conclusion: existing 15-day plan ek working MVP aur limited monitoring prototype ke liye useful hai, lekin tumhari saari discussed features ko properly implement, integrate aur test karne ke liye current structure mein changes zaroori hain.**

Tumhare original plan mein upload-based investigation, AI assistant, Linux agent, live ingestion, MSP multi-client operations, billing aur webhooks included hain. Lekin advanced integrations, agent management, notification reliability aur production operations ke liye sufficient dedicated implementation time nahi hai. Pasted text(20261027-054014)

Aur ek important distinction: **15 milestones complete karna aur product ke saare features verified hona alag baatein hain.** Antigravity implementation report, successful build aur actual end-to-end testing ko separate rakhna hoga.

## 1. Existing plan mein kya missing hai?

| Feature area | Existing plan | Meri assessment |
|---|---|---|
| Authentication and workspaces | Days 1–2 | Existing foundation ko regression-test karna hai |
| Uploads, parsing and detections | Days 3–5 | Core functionality, boundary tests aur reliability verify karni hai |
| Dashboard, investigations and reports | Days 6–7 | Existing functionality ko end-to-end verify karna hai |
| AI investigation | Day 8 | Provider integration aur evidence validation verify karni hai |
| Security hardening | Day 9 | Broad scope; multiple security checks required |
| End-to-end MVP | Day 10 | Staging, complete workflow aur release blockers |
| Linux monitoring agent | Day 11 | Enrollment, service lifecycle, buffering aur revocation |
| Live ingestion | Day 12 | Reliable delivery, heartbeat, notifications aur deduplication |
| MSP multi-client operations | Day 13 | Organization/client model aur strict isolation |
| Billing and integrations | Day 14 | Billing, webhook delivery aur deployment automation |
| Final release audit | Day 15 | Verification only; incomplete features automatically complete nahi ho jaate |

### Sabse important missing pieces

**1. Dedicated integration management**

Businesses ko apne servers connect karne ke liye ek proper interface chahiye:

- Add Integration / Add Server.
- Integration type selection.
- Secure enrollment flow.
- Agent status and last-seen information.
- Credential rotation and revocation.
- Installation instructions.
- Integration errors and ingestion health.

Original plan agent aur live ingestion cover karta hai, lekin complete integration management experience ko clearly separate deliverable nahi banata.

**2. External integrations**

Abhi tak discussed architecture mein kai possible integration types hain:

- Linux monitoring agent.
- Secure event ingestion API.
- Outbound alert webhooks.
- Email notifications.
- Future Windows, cloud aur ticketing integrations.

In sab ko ek saath fully support karna 15-day schedule mein realistic nahi hai. Pehle ek reliable Linux integration complete karni chahiye.

**3. Production operations**

Sirf application deploy kar dena enough nahi hai. Humein monitoring, failed-job recovery, backup restoration, safe configuration, deployment rollback aur agent upgrade strategy ko bhi verify karna hoga.

**4. Commercial functionality**

Billing ke saath subscription lifecycle, usage metering, server-side quotas, payment webhook verification aur cancellation ke baad access enforcement bhi chahiye.

**5. Customer onboarding**

Ek naya MSP user ideally apna organization create kar sake, client add kare, server enroll kare, incoming events dekhe aur alert ka report export kar sake—without developer intervention.

Yeh complete workflow current plan mein multiple milestones mein distributed hai, lekin ise final acceptance test ke roop mein explicitly define karna zaroori hai.

---

# 2. Revised roadmap — Day 10 se Day 15 tak

Meri recommendation hai ki hum remaining milestones ko reorganize karein. Hum existing working features ko dobara build nahi karenge. Pehle gaps inspect karenge, phir missing features implement karenge aur end-to-end verify karenge.

Is revised roadmap ka target hoga:

**A working, upload-based security SaaS with a first Linux integration, basic MSP client management, and commercial foundations—provided implementation and testing succeed.**

Yeh full enterprise-grade SIEM ya production-proven MSP platform ka promise nahi hai.

## Day 10 — MVP Stabilization and Integration Management

### Goal
Existing upload-based product ko stabilize karna aur business infrastructure integrate karne ke liye proper management system banana.

### Kya implement karna hai?

**A. Existing product stabilization**
- Registration se investigation report tak complete workflow verify karo.
- Upload, parser, detection engine aur alert evidence links verify karo.
- Case creation, notes, assignment aur report export test karo.
- AI provider integration, schema validation aur fabricated evidence rejection verify karo.
- Existing failures ko document karke critical blockers resolve karo.

**B. Integration Management**
- Workspace ke andar Integrations ya Assets section add karo.
- `Add Integration` / `Add Server` workflow implement karo.
- Pehle supported integration ke roop mein Linux authentication logs select karo.
- Har integration ke liye unique asset identity aur workspace association maintain karo.
- Integration status, creation time aur last-seen information store karo.
- Integration configuration aur lifecycle ke liye authorized API operations implement karo.

**C. Secure enrollment foundation**
- One-time, short-lived enrollment tokens.
- Token expiry aur single-use enforcement.
- Agent-specific credentials issue karne ka flow.
- Credential revocation.
- Enrollment actions ka audit trail.

**D. User experience**
- Installation instructions.
- Enrollment status.
- Pending, connected, disconnected aur error states, jahan applicable hon.
- Safe error messages aur troubleshooting guidance.

### Acceptance test

Test user ek integration create kar sake, enrollment initiate kar sake, aur integration ko authorized workspace ke saath associate kar sake.

Actual agent communication abhi Day 11–12 mein verify hogi.

---

## Day 11 — Linux Monitoring Agent

### Goal
Customer ke authorized Linux server par install hone wala pehla working collector banana.

### Kya implement karna hai?

- Ek specific Linux distribution aur version ko officially supported target banana.
- Selected authentication logs collect karna.
- Agent configuration ko securely store karna.
- Enrollment token exchange karke agent-specific credential obtain karna.
- Stable server/asset identity maintain karna.
- Local buffering implement karna, with a strict disk-space limit.
- Network failure par bounded retries aur backoff.
- Safe service startup, shutdown aur uninstall.
- Credential revocation ke baad unauthorized collection delivery ko reject karna.
- Minimum required permissions document karna.

### Security requirements

Agent ko:
- Arbitrary shell commands execute nahi karne chahiye.
- Customer ke firewall ya accounts modify nahi karne chahiye.
- Unnecessary files collect nahi karni chahiye.
- Secrets plaintext mein unnecessarily store nahi karne chahiye.

### Acceptance test

Ek isolated Linux test server enroll ho, selected logs collect kare aur authenticated batches bhejne ke liye ready ho.

Agar Linux test environment available nahi hai, to agent ko implemented but unverified mark karenge.

---

## Day 12 — Live Ingestion, Integration Health and Notifications

### Goal
Agent se aane wale events ko existing Sentinel detection pipeline mein integrate karna.

### A. Secure ingestion

- Authenticated agent event-batch endpoint.
- Workspace aur asset ownership validation.
- Event schema validation.
- TLS-protected transport.
- Event identity aur deduplication.
- Duplicate/replayed batches ka safe handling.
- Upload-based aur live-ingestion workflows ke liye same normalization aur detection pipeline reuse karna.

### B. Delivery reliability

- Bounded retry with backoff.
- Network interruption ke dauran local buffering.
- Batch acceptance aur processing status.
- Failed-batch visibility.
- Heartbeat aur last-seen timestamps.
- Agent version aur collection status.
- Credential rotation and revocation.

### C. Integration dashboard

Business ko dikhna chahiye:
- Kitne servers registered hain.
- Kaun se agents connected ya inactive hain.
- Last event kab receive hua.
- Processing failures aur delivery delays.
- Events received aur configured usage limits.

### D. Alert notifications

- Configurable email notifications.
- Alert severity aur workspace preferences.
- Notification delivery status.
- Safe retries aur duplicate notification prevention.

### Acceptance test

Linux test server se log event bhejo, usse Sentinel mein normalized event ke roop mein verify karo, detection trigger karo aur corresponding alert dashboard par dekho.

Network disconnect karke reconnect karne ke baad recovery bhi test karo.

**Is milestone ke baad hamare paas manual uploads ke alawa pehla working continuous log-integration path hona chahiye.**

---

## Day 13 — MSP Multi-Client Platform

### Goal
Ek MSP ko ek account se multiple business clients manage karne dena.

### Kya implement karna hai?

**Organization and clients**
- MSP organization create aur manage karna.
- Client workspaces create karna.
- Existing workspace model ke saath compatible client ownership.
- Client switching interface.
- Client-specific settings aur authorized membership.

**Centralized monitoring**
- Authorized clients ka consolidated alert overview.
- Client ke hisaab se severity aur status filters.
- Per-client assets aur agent health.
- Client-specific event explorer.
- Client-scoped cases, notes aur assignments.
- Client-specific report exports.

**Usage visibility**
- Per-client event volume.
- Upload and AI usage.
- Retained-data usage, where implemented.
- Configured limits aur quota warnings.

**Access control**
- MSP Owner/Admin/Analyst/Viewer permissions.
- Client-specific permissions.
- Optional client-side read-only access, agar current scope mein implement ho sake.
- Backend par every resource access ki authorization.

### Acceptance test

Ek MSP organization ke andar kam se kam do synthetic client environments create karo.

Verify karo ki:
- Authorized MSP staff assigned clients access kar sake.
- Client A ke users Client B ke logs, alerts, cases, reports ya agent credentials access na kar saken.
- Client-specific exports sahi tenant ka data contain karein.
- Consolidated views sirf authorized clients include karein.

**Note:** Existing workspaces ko bina zaroorat replace mat karna. Pehle determine karo ki organization/client relationship ko current database model mein safely kaise add kiya ja sakta hai.

---

## Day 14 — Billing, Webhooks and Deployment Automation

### Goal
SaaS ke commercial foundations aur selected external integrations ko implement karna.

### A. Subscription and billing

- Free, Starter, Pro aur MSP plans ke configurable definitions.
- Plan entitlements aur usage limits.
- Server-side quota enforcement.
- Payment provider integration, target market ke hisaab se.
- Subscription creation aur status management.
- Successful payment, failed payment aur cancellation handling.
- Verified payment webhooks.
- Duplicate webhook delivery ka idempotent handling.
- Subscription status ke according access enforcement.

Pricing ko customer interviews aur usage costs ke basis par validate karna hoga. Plans ki definitions ko automatically validated market pricing nahi samajhna.

### B. Outbound alert webhooks

Authorized customers ko security alerts apne external systems tak forward karne ki facility deni hai.

Implement:
- Workspace-scoped webhook configuration.
- Signed webhook payloads.
- Timestamp validation aur replay protection.
- Delivery history.
- Retry policy aur timeout.
- Secret rotation.
- Failure visibility.
- Duplicate delivery handling.

Webhook endpoints ko arbitrary internal URLs ya cloud metadata endpoints access karne dene se bachao; outbound request destinations validate karo aur SSRF protections implement karo.

### C. Deployment automation

- Automated linting, type checks aur tests.
- Dependency aur secret scanning.
- Staging deployment workflow.
- Environment-specific secrets.
- Database migration verification.
- Backup and restore instructions.
- Rollback and recovery procedures.

### Acceptance test

Sandbox payment flow verify ho, subscription status correctly update ho, quota server-side enforce ho aur signed alert webhook successful aur failed delivery cases mein expected behaviour dikhaye.

Agar payment provider credentials ya required infrastructure available nahi hain, to feature ko blocked ya partially verified report karna hai—not completed.

---

## Day 15 — Full-System Verification and Release Decision

### Goal
Saare milestones ke outputs ko ek integrated product ke roop mein verify karna aur decide karna ki product controlled pilot ke liye ready hai ya nahi.

Day 15 ko major new features add karne ke bajaye verification, blocking fixes aur release decision ke liye reserve rakho.

### A. Complete end-to-end workflow

Test this entire journey:

1. User registration aur sign-in.
2. Workspace creation.
3. Integration creation.
4. Linux agent enrollment.
5. Log collection aur secure transmission.
6. Event normalization aur database persistence.
7. Deterministic detection aur alert generation.
8. Evidence-backed AI investigation.
9. Case creation, notes aur assignment.
10. Investigation report export.
11. MSP client switching aur consolidated views.
12. Subscription/usage enforcement, where configured.

Manual upload workflow ko bhi separately test karna hai, taaki agent integration se existing functionality break na ho.

### B. Security regression

- Cross-workspace aur cross-client access attempts.
- Agent credential revocation.
- Malicious filenames aur oversized uploads.
- Unauthorized exports.
- Invalid AI citations aur prompt injection.
- Rate limits aur usage quotas.
- Raw-log storage privacy.
- Deletion aur retention behaviour.
- Audit history.
- Secret exposure checks.

### C. Reliability and recovery

- Worker restart.
- Database connection interruption.
- Agent network outage.
- Failed batch retry.
- Duplicate event prevention.
- Backup restore in an isolated environment.
- Migration and rollback procedure verification.

### D. Release report

Har feature ko in statuses mein classify karo:

| Status | Meaning |
|---|---|
| PASS | Acceptance criteria reproducible test se verify hue |
| PARTIAL | Implementation hai, lekin kuch requirements ya verification pending hain |
| FAIL | Test execute hua aur expected behaviour fail hua |
| NOT IMPLEMENTED | Working implementation nahi hai |
| BLOCKED | Required infrastructure, credentials ya environment unavailable hai |

Final report mein unresolved security risks, unsupported log sources, known limitations aur deployment gaps clearly document karo.

### Acceptance test

Product ko controlled pilot ke liye tabhi recommend karna hai jab critical security checks pass hon aur complete workflow verified ho.

---

# 3. Kya in 15 days mein saare discussed features complete ho jayenge?

Yahan ek important distinction hai.

Tumhare project plan mein **MVP, continuous monitoring, MSP functionality aur advanced commercial/enterprise features** alag levels par hain. Advanced feature checklist mein Windows Event Logs, cloud integrations, ticketing connectors, SSO, custom detection rules, high availability aur advanced response capabilities bhi hain. Pasted text(20261027-054014)

In sab ko Day 10–15 ke andar production-quality level par implement karna realistic nahi hai.

Isliye revised scope ko teen categories mein divide karna chahiye:

### Scope A — Target for the current 15-day build

- Existing upload-based product.
- Deterministic threat detections.
- Evidence-linked alerts.
- Investigation cases and report exports.
- Working AI investigation assistant.
- Security hardening.
- Integration management for Linux.
- One supported Linux collection agent.
- Secure live ingestion and basic agent health.
- Basic MSP multi-client operations.
- Initial billing and outbound webhook foundations.
- End-to-end verification.

Ye bhi ambitious hai, aur current codebase ki actual state par depend karega.

### Scope B — Build only if core acceptance tests pass

- Scheduled client reports.
- Advanced agent-update infrastructure.
- Additional email notification controls.
- More detailed MSP usage reporting.
- Expanded installation automation.
- Additional supported Linux distributions.

### Scope C — Later milestones, not promised within this build

- Windows Event Log integration.
- Cloud audit-log connectors.
- Jira/ServiceNow ticketing integrations.
- Slack/Microsoft Teams integrations.
- Full public API platform and API key management.
- SSO and enforced MFA.
- Custom advanced detection and historical anomaly detection.
- High-availability architecture and large-scale queue infrastructure.
- Enterprise data-residency options.
- Human-approved automated remediation.

In features ko defer karna failure nahi hai. Ye scope control hai, taaki core product secure aur usable ban sake.

---

# 4. Revised schedule follow karne ka sahi tareeqa

Meri recommendation hai ki har milestone mein ye workflow maintain karein:

**Inspect → Implement → Automated Tests → Manual Verification → Record Results → Continue**

Tum Antigravity ki implementation report share karoge. Uske baad hum manual tests run karenge, failures collect karenge aur zaroorat par ek consolidated fix prompt banayenge.

Kisi feature ko sirf isliye complete nahi mark karna hai kyunki:
- UI page ban gaya.
- API endpoint exist karta hai.
- Antigravity ne tests pass hone ka claim kiya.
- Build successful hai.

Actual acceptance criteria verify hone chahiye.

## Final recommendation

**Day 10 ko integration management aur MVP stabilization se start karo.** Day 11–12 mein Linux agent aur live ingestion complete karo, Day 13 mein MSP multi-client functionality, Day 14 mein commercial integrations, aur Day 15 ko full-system release verification ke liye reserve rakho.

Agar kisi milestone ke critical acceptance tests fail hote hain, to us failure ko next milestone ke neeche chhupane ke bajaye resolve karna ya explicitly block karna hai.

Is roadmap ka objective 15 din ke naam par saare features jaldi-jaldi add karna nahi, balki NomaanOS Sentinel ko ek **verifiable, end-to-end working security SaaS** banana hai—jismein manual log uploads se lekar first continuous Linux integration tak ka complete workflow kaam kare.







































# NomaanOS Sentinel — Complete Build Plan, Feature Checklist, Integrations, and SaaS Business Model

Your uploaded project plan gives us a strong starting point for NomaanOS Sentinel, an AI-assisted security monitoring and investigation platform for small businesses, IT consultants, and Managed Service Providers (MSPs).

The goal is to build it from scratch using Google Antigravity as our development environment, starting with a working log-analysis product and gradually expanding it into a commercially usable MSP security platform.

The most important decision is this: we should not build only a website where someone uploads a PDF or log file and gets an AI response. We should build a real security investigation platform that can begin with uploads, then connect to customers' servers, collect logs continuously, detect suspicious activity, manage multiple client environments, and charge recurring subscriptions.

Your plan already defines this progression: upload-based investigation first, continuous Linux monitoring second, and MSP multi-client operations and commercial expansion third.&#x20;

NomaanOS_Sentinel_Full_Project_Plan(1).docx



## 1. What exactly are we building?

[Cybersecurity Admin Dashboard by Yeasin Islam on Dribbble](https://images.openai.com/static-rsc-4/RroZuS-qTC8lwDrvKJXiJv3dfTqfbNy2zJM392wOSINKOV_mLhtjyjszJAJzCJH9JXyuroKI6CrLTitgWJuqyx7AfnFs1V-NEhdSusyyTyXhkFMv3SpULkO-c2u4DwYp-h9GsuY9zPPf7JDlUIvFppfOuSw8cZj8ryVzLdEbD-Q?purpose=inline)

NomaanOS Sentinel

Security investigation SaaS

Helps customers understand suspicious server activity, investigate alerts, and produce evidence-backed security reports.

Log analysis

Upload existing logs and investigate historical activity.

Live monitoring

Collect supported security events continuously from enrolled servers.

MSP operations

Manage multiple business clients from one account.

AI investigation

Explain evidence, recommend checks, and help prepare client reports.

### Who will pay for it?

Our first target should be small MSPs and IT consultants who manage Linux servers for several small businesses. Secondary customers are small SaaS companies and independent system administrators.

The customer is not paying just to upload a file. They are paying to save investigation time, receive useful alerts, understand what happened, maintain a history of incidents, and provide professional reports to their clients.

### The three product levels

| Level                     | What the customer gets                                                                              | How they connect                          |
| ------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Level 1 — Upload SaaS     | Historical log analysis, detections, AI explanations, cases and reports                             | Upload supported files                    |
| Level 2 — Monitoring SaaS | Continuous events, asset inventory, alert notifications and agent health                            | Install a lightweight Linux agent         |
| Level 3 — MSP platform    | Multiple clients, separate workspaces, centralized alerts, client reports, billing and integrations | Enroll servers across client environments |

These are three development stages of the same product, not three separate applications.

One important limitation: the current plan does not describe a complete enterprise SIEM, full endpoint detection platform, or autonomous security operations center. We should not advertise those capabilities until we genuinely implement and validate them.&#x20;

NomaanOS_Sentinel_Full_Project_Plan(1).docx



## 2. Complete feature checklist — from the first version to an advanced MSP product

Use this as our master checklist while building in Antigravity. The checkboxes are a roadmap, not a claim that the features already exist.

The phases below distinguish the features in your uploaded plan from additional recommendations for a more mature commercial product.

### Phase 0 — Product foundation and development setup

Before building customer-facing functionality

Foundation readiness

0/12

Confirm the initial buyer and first security use case

Choose the first supported Linux authentication-log format

Create the Git repository and issue tracker

Write architecture and threat-model documents

Set up local development with Docker Compose

Create development, staging and production configurations

Create environment-variable templates and secret-handling rules

Define the normalized security-event schema

Create synthetic log files and expected detection results

Document supported formats, limitations and data retention

Create automated formatting, linting and type-checking

Set up database migrations and application health checks

### Phase 1 — MVP: Upload and investigate

This is the first complete product we should make usable by real pilot customers.

MVP master checklist

All feature areas in one tracker

## 0/66

### A. Accounts and workspace

Registration and sign-in

Email verification and password reset

Session expiration and secure cookies

Workspace creation and management

Owner/admin/analyst/viewer permissions

Server-side workspace authorization

Basic member management

### B. File uploads and processing

Drag-and-drop and file picker

Supported-format documentation before upload

File size, content, encoding and line-count validation

Private storage for uploaded logs

Upload progress and processing status

Queued, parsing, detecting, complete and failed states

Parsing statistics: valid, skipped and malformed lines

Safe retry handling and duplicate prevention

Dataset deletion and retention enforcement

### C. Log parsing and normalization

Initial Linux auth.log/secure-style authentication parsing

Extract timestamps, hosts, process IDs and usernames where available

Extract source IP, event type and outcome where available

Normalize timestamps to UTC while preserving uncertainty

Retain source-line references

Record parser version and dataset hash

Count and explain malformed or unknown records

Unit tests for timezone and malformed input

### D. Detection engine

Repeated failed authentication detection

Successful login after repeated failures

Supported privileged-account activity detection

New authentication source detection when enough history exists

Parser-anomaly detection when justified

Versioned detection rules and configurable thresholds

Severity rationale and detection explanations

Alert fingerprinting and deduplication

Supporting event IDs for every alert

Positive, negative, boundary and regression tests

False-positive feedback and reasons

### E. Dashboard and investigation

Overview dashboard and recent alerts

Alert counts by severity and status

Alert detail with rule, time window and evidence

Event explorer with pagination

Search by host, username, IP, date and event type

Filters by severity, rule, host and status

Nearby-event investigation

Investigation cases and case notes

Case status: open, investigating, resolved or false positive

Assignment where supported

Case history and timestamps

PDF or other documented report export

### F. AI investigation assistant

Plain-language explanation of an alert

Separate observed facts, hypotheses and unknowns

Evidence-linked event IDs

Suggested safe, read-only investigation checks

Client-facing report drafts

Strict output schema validation

Reject or flag nonexistent evidence IDs

Redact secrets and minimize evidence sent to AI

Prompt-injection tests for hostile log content

Provider adapter, timeouts, rate limits and usage metering

### G. SaaS administration

Synthetic demo dataset and demo workflow

Audit history for sensitive actions

Configurable retention defaults

Usage quotas for uploads, events, AI and retention

Clear processing errors and recoverable failures

Workspace-scoped search and access

Account and workspace settings

Privacy notice and deletion controls

Usage and operational cost metrics

&#x20;Copy MVP checklist

The MVP is complete only when the full workflow works end to end: sign in, upload a supported log, process it, investigate evidence, open a case, record findings and export a report. The upload page alone is not a complete MVP.&#x20;

NomaanOS_Sentinel_Full_Project_Plan(1).docx



### Phase 2 — Continuous Linux monitoring

Turn the product from a file-analysis tool into a monitoring service

Phase 2 checklist

0/23

Lightweight Linux monitoring agent

Documented installation and uninstallation instructions

Supported Linux distribution and version matrix

One-time, expiring enrollment tokens

Asset registration and server identity

Per-agent credentials and secure credential storage

TLS-protected event ingestion

Agent credential rotation and revocation

Collection of explicitly selected authentication/security logs

Bounded local queue during network outages

Retry with backoff and duplicate-event prevention

Event sequence IDs and replay protection where applicable

Agent heartbeat and last-seen status

Agent version, health and collection status

Asset inventory and enrollment status

Alert notifications by email

Configurable alert thresholds and quieting

Alert deduplication

Delivery-lag and failed-batch monitoring

Agent update strategy and integrity checks

Remote uninstall/cleanup instructions and credential revocation

Monitoring-service health dashboard

Documented minimum permissions and privacy impact

&#x20;Copy Phase 2 checklist

Important safety decision: the initial monitoring agent should collect only the agreed logs. It should not run arbitrary shell commands, disable accounts, modify firewalls or automatically remediate systems. Those capabilities create substantially greater risk and are not part of the proposed early product.&#x20;

NomaanOS_Sentinel_Full_Project_Plan(1).docx



### Phase 3 — MSP multi-client platform

This is where NomaanOS Sentinel becomes useful to a company managing many customer environments.

Phase 3 checklist

0/26

MSP organization account

Create and manage separate client workspaces

Switch between clients from a centralized console

Strict isolation of one client's data from another

MSP owner and administrator roles

Analyst and read-only viewer roles

Optional client-side viewer accounts

Client-scoped assets and agent enrollment

Central alert overview across authorized clients

Client-specific alert and severity views

Client-specific investigation cases

Client-specific notes and reports

Consolidated reporting for the MSP

Usage and event-volume breakdown per client

Client-specific access permissions

Client-level retention configuration when supported

Saved filters and investigation templates

Scheduled security reports

Notification preferences per workspace

Signed outbound webhooks

Webhook delivery history, retries and secret rotation

Subscription plans and server-side quota enforcement

Billing, invoices/receipts and cancellation

Account and data export

Auditable MSP administrative actions

Tests proving cross-client data isolation

&#x20;Copy Phase 3 checklist

Your source plan specifically places client workspaces, MSP roles, consolidated reporting, usage visibility, webhooks and billing in the commercial expansion phase.&#x20;

NomaanOS_Sentinel_Full_Project_Plan(1).docx



### Phase 4 — Advanced commercial and enterprise features

These are recommended future additions, not all features promised by the uploaded plan. Prioritize them only when customers ask for them and the core platform is reliable.

Advanced feature backlog

0/33

### Additional integrations

Windows event-log ingestion

Selected cloud audit-log integrations

Ticketing integration with systems such as Jira or ServiceNow

Chat and alert destinations such as Slack or Microsoft Teams

SIEM export and standardized event forwarding

Public API and API key management

Integration catalog and setup guides

### Advanced detection

Correlation across hosts and time windows

Custom rules and customer-specific thresholds

Allowlisting and suppression controls

Historical baselines and anomaly detection

Threat-intelligence enrichment where justified

Detection rule testing and controlled deployment

Detection quality and false-positive dashboards

### Enterprise administration

Single sign-on (SSO)

Multi-factor authentication enforcement

Granular custom roles

Custom retention and data-residency options

Enterprise audit exports

Formal uptime and support commitments when operationally justified

Security assessments and a vulnerability disclosure process

### Scale and reliability

High-availability deployment

Queue scaling and back-pressure

Database partitioning when needed

Disaster recovery and tested restore procedures

Service-level monitoring and incident runbooks

Customer-facing service status

Capacity and cost forecasting

Controlled release, rollback and agent-update systems

### Potential advanced response capabilities

Human-approved remediation workflow

Integrations with approved response tools

Explicit approvals, audit trails and rollback controls

Restricted actions with customer-defined permissions

Even in an advanced version, keep AI-generated suggestions separate from confirmed evidence and require explicit authorization for any response action. More features do not automatically make a security product more trustworthy.

## 3. The most important question: file upload or real integration?

The answer is both, but we build them in stages.

There are three fundamentally different ways a customer can send security information to NomaanOS Sentinel.

[Network Security Essentials | THM | by Isiah | Jan, 2026 | Medium](https://images.openai.com/static-rsc-4/1QXzU6OT6_y_2mTCTUGVTKe55cN64yq2tH55hlceRx1BFmkO2ftRBDC7RaxvMwH7OZt21g8D_rLn7kRvkKTj-lolcc7se8mY6JfF0qW4SAtz-ElUBkILc3PeFi_lgckgXPBNTGk8twARGJ9jMntChxefnAX_IMXkf2g5OYbXb8M?purpose=inline)

Method A — Upload logs manually

MVP

A customer downloads a log file from a Linux server and uploads it to our website. We process it and display events, alerts, AI explanations and reports.

Best for initial development, historical investigations and customers who do not want to install an agent.

[Curso de Introducción a la Administración de Servidores Linux](https://images.openai.com/static-rsc-4/d61b9jIyYCGTaoge9gzGJ3Yygewlb2b6_BrMHZs3QaEcC_hTTYFWzK1LDw7dF1FFBUFxVGVwUYslaTAfV5LBZv_CPJQqBAvIaePSrHQMZdNjfdGXJ-lbdrOABmbKNgTQbUvaWG8H0LHuIKYfskH4wRaT7xgmkYY74Rn6bjOP24w?purpose=inline)

Method B — Install our monitoring agent

Phase 2

The customer installs a small service on an authorized Linux server. It collects selected log events and securely sends them to our cloud platform.

Best for continuous monitoring, recurring alerts and recurring subscription value.

[Fortinet erweitert Managed SOC-as-a-Service: Zugängliche Cyberabwehr für jedes Unternehmen | Fortinet Blog](https://images.openai.com/static-rsc-4/hBjDqkGk_rCN5r7VgY-E4dKLcB6UZBrgjL1YAGjUj8PcIsd-Zge3g6CbfGIewyfbs5b54VBc0peGaDIhkwgh1vVzJlSKCfzV0XzB6c9UP2mRCE1nweEP0PMuC5_D2FjtUsVS7AMUQ4H2ahxF7sAXYI3CeIhcQ17e6nZtD7JoB1Q?purpose=inline)

Method C — Connect existing systems

Phase 3–4

Customers connect supported logging, cloud, ticketing or alerting systems through APIs, agents, webhooks or native connectors.

Best for MSPs and larger customers who already use infrastructure monitoring and IT service-management tools.

### How a file upload actually works

Imagine a small business has a Linux server and suspects that someone has been trying to guess SSH passwords.

Customer's Linux server

Contains authentication logs

Customer downloads auth.log

No server integration required

NomaanOS Sentinel processes the file

Validate → parse → normalize → detect

Evidence-backed alerts

Failed logins, correlated activity, timestamps and source IPs where available

AI explanation and investigation

Facts, hypotheses, unknowns and suggested checks

Case report

Review, document and export findings

The customer does not need to give us SSH access just to upload a log file. The file is processed by our application and worker; a PDF report can be an output, but it is not the main input format for the initial product.

The MVP should primarily accept documented Linux authentication-log formats. A PDF or screenshot of logs is a different problem because text extraction and OCR introduce extra uncertainty. We should add that only if customer demand justifies it.

### What happens when we add live integration?

The workflow changes to this:

Server A

Linux authentication logs

Server B

Linux authentication logs

Sentinel agent on each enrolled server

Collects approved logs and sends batches over TLS using its own credentials.

Secure ingestion API

Authenticate agent, validate batch, reject replays and handle retries.

Same processing engine

Normalize events, run versioned detection rules and link evidence to alerts.

Live dashboard and notifications

Events, alerts, cases, asset health and investigation reports

The key architectural decision is to reuse the same normalization and detection pipeline for uploaded files and live events. We should not create a separate detection system for each integration. Your project plan already recommends this shared pipeline.&#x20;

NomaanOS_Sentinel_Full_Project_Plan(1).docx



## 4. How customers will integrate Sentinel into their systems

We should make integration easy enough that a small IT consultant can set it up without needing a security engineering team.

### Integration option 1: Manual upload

The customer:

1. Creates an account.
2. Creates a workspace.
3. Downloads an existing authentication log from the server.
4. Uploads it to Sentinel.
5. Reviews the alerts and exports a report.

This is the simplest onboarding method and the first one we should finish.

### Integration option 2: Linux agent installation

The eventual customer experience should look like this:

1. The customer opens Assets → Add server.
2. Sentinel displays an installation guide for the supported Linux distribution.
3. The customer generates a single-use, short-lived enrollment token.
4. They run the documented installer on the authorized server.
5. The agent exchanges the token for its own revocable credential.
6. The server appears in the asset inventory.
7. The agent starts collecting only the approved logs.
8. Sentinel displays the server's connection status and begins processing received events.

An example of the future command interface might look like this:

```
# Illustrative only — this installer must be built and published first.
sudo sentinel-agent enroll --token <ONE_TIME_TOKEN>
```

We must not tell customers to execute a command like this until the installer exists, is verified and has a documented security model.

The agent needs minimum permissions, TLS, credential rotation and revocation, bounded local buffering, retry handling and safe update/uninstall procedures. It should never rely on one shared global secret for every customer's servers.&#x20;

NomaanOS_Sentinel_Full_Project_Plan(1).docx



### Integration option 3: API and webhooks

Once the core product is stable, we can let authorized external systems exchange information with Sentinel.

| Integration mechanism | Direction                                 | Example                                                         |
| --------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| Ingestion API         | Into Sentinel                             | A customer agent sends security-event batches                   |
| REST API              | Both directions, according to permissions | An MSP's internal dashboard retrieves alerts                    |
| Outbound webhook      | From Sentinel                             | A new high-priority alert is sent to another system             |
| Email notifications   | From Sentinel                             | An administrator receives an alert notification                 |
| Ticketing connector   | Both directions where supported           | An alert creates or updates an incident ticket                  |
| Cloud-log connector   | Into Sentinel                             | Supported cloud audit events enter the same processing pipeline |

Webhooks need signed payloads, timestamp validation, replay protection, retries, delivery logs and secret rotation. API access must be scoped to authorized workspaces, and webhook delivery must not expose one client's information to another.

### Integration option 4: MSP client onboarding

This is the feature that makes the product commercially interesting for MSPs.

An MSP manages several businesses. Instead of opening a separate Sentinel account for every business, it creates one MSP organization and separate client workspaces.

For example:

ABC Managed IT

MSP organization

Client A

3 servers

Client B

12 servers

Client C

5 servers

Illustrative example: every client has its own assets, alerts, investigations, permissions and reports. Authorized MSP staff can see the clients assigned to them.

The MSP can then:

- View alerts across its authorized clients.
- Filter by client, severity and status.
- Investigate an event within the correct client's environment.
- Assign work to an analyst.
- Export a report branded or formatted for a particular customer.
- Review usage and subscription limits.
- Send reports to clients on a schedule once that feature is implemented.

The most critical requirement: tenant isolation. Client A must never be able to read Client B's logs, alerts, cases, exports or agent credentials. This must be enforced in the backend and verified through automated security tests, not just hidden in the interface.

## 5. Complete technology stack — from scratch to advanced MSP

The uploaded plan recommends a TypeScript web application, a modular API, Python-based log parsing, PostgreSQL, private file storage, background processing and an AI-provider adapter.&#x20;

NomaanOS_Sentinel_Full_Project_Plan(1).docx



I recommend the following implementation stack for our project.

These are engineering recommendations for the build, not claims that every component is already installed or that every advanced feature is required in the MVP.

### Recommended technology map

### 1. Frontend — customer-facing website

Next.js

React

TypeScript

Tailwind CSS

Landing page, authentication, dashboards, event tables, alert details, cases, asset inventory and settings.

### 2. Backend — application API

Node.js

Express

TypeScript

OpenAPI

Authentication integration, workspaces, authorization, uploads, alert APIs, cases, quotas, subscriptions and integrations.

### 3. Security analysis engine

Python

pytest

Structured schemas

Parse Linux logs, normalize events, run deterministic rules, calculate alert fingerprints and link evidence.

### 4. Database and file storage

PostgreSQL

SQLAlchemy or Prisma

Private S3-compatible storage

Users, organizations, memberships, events, alerts, cases, subscriptions and audit history; raw files remain private.

### 5. Background processing

Background worker

Database-backed jobs initially

Redis + queue later

Processes uploads, retries failed jobs, records progress and prevents duplicate alerts. Add a dedicated queue when scale justifies it.

### 6. AI investigation

LLM provider API

Structured JSON output

Evidence validation

Explains detections using minimal evidence, distinguishes facts from hypotheses and validates every referenced event.

### 7. Security and identity

Trusted authentication library

TLS

Role-based access

Secret manager

Secure sessions, tenant isolation, credentials, rate limiting, audit trails and protection for customer logs.

### 8. Deployment and operations

Docker

GitHub Actions

Managed hosting

Monitoring

Reproducible builds, automated tests, staging, production deployment, backups, health checks and recovery procedures.

### Which technologies should we actually use first?

| Component             | Initial decision                                  | When to expand                                         |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| Frontend              | Next.js + TypeScript                              | Add more advanced dashboard visualizations when useful |
| API                   | Express + TypeScript                              | Split services only when necessary                     |
| Parser and detections | Python modules                                    | Separate service if deployment or scale requires it    |
| Database              | PostgreSQL                                        | Tune indexing and partitioning as volume grows         |
| Background jobs       | Simple database-backed jobs or managed job runner | Redis-backed queue if justified                        |
| File storage          | Private object storage in production              | Lifecycle policies and retention tiers                 |
| AI                    | Provider adapter with schema validation           | Add another or local model after testing               |
| Email                 | Transactional email provider                      | Configurable alert and scheduled-report delivery       |
| Billing               | Payment provider suited to business geography     | MSP metering and more advanced invoicing               |
| Deployment            | Docker Compose locally                            | Managed production hosting and automated releases      |

### Additional tools we should use

- Git and GitHub: version control, pull requests and release history.
- Playwright: end-to-end browser tests.
- pytest and API integration tests: parser and detection correctness.
- Sentry or an equivalent error-monitoring tool: application failures.
- Prometheus/Grafana or a managed equivalent: infrastructure and processing metrics as the product grows.
- Dependency and secret scanning: identify vulnerable packages and accidental credential exposure.
- A transactional email provider: verification, password resets and alert delivery.
- A payment provider: subscriptions and verified billing events once paid plans are ready.

We do not need every tool on day one. The core rule is to build the simplest architecture that is secure and testable, then introduce extra infrastructure only when the workload requires it.

### What is Antigravity's role?

Antigravity is the development environment we will use to help write, inspect, test and improve the code. It is not the database, hosting platform, security detection engine or integration mechanism itself.

Our workflow should be:

1. Give Antigravity one well-defined development task.
2. Ask it to inspect the existing repository before editing.
3. Have it implement the feature and the relevant tests.
4. Review its changes and run the tests locally.
5. Verify security-sensitive behavior yourself.
6. Commit working changes to Git.
7. Move the tested feature through staging and production.

We should not ask an AI coding agent to build the entire platform in one enormous instruction and assume the result is production-ready.

## 6. How the complete application works internally

The same core pipeline should support uploads, agent events and future integrations.

Uploads

Linux agent

Connectors

Ingestion and validation

Authentication, file limits, authorization, idempotency and job creation

Parser and normalization

Convert supported input into a consistent event format

Deterministic detection engine

Apply versioned rules and link alerts to supporting events

PostgreSQL

Events, alerts and cases

AI assistant

Advisory explanations

Workspace-scoped dashboard

Events, alerts, cases, reports, audit records and usage

### Why not let AI detect everything?

Because security findings need repeatable evidence. A language model may explain an event incorrectly or misunderstand attacker-controlled text inside a log.

Instead:

- Deterministic rules decide whether a defined detection condition has been met.
- The system records the actual supporting events.
- AI explains the evidence and suggests safe next checks.
- The analyst decides whether the finding is a genuine incident.

This gives customers an explanation they can verify instead of an unexplained AI-generated risk score. It also makes testing, debugging and investigating false positives much easier.&#x20;

NomaanOS_Sentinel_Full_Project_Plan(1).docx



## 7. How an actual customer will use the service

Let's walk through a realistic example.

Imagine an MSP called ABC Managed IT manages Linux servers for ten small businesses.

### Before using Sentinel

An administrator receives a complaint that one of a client's servers may be experiencing suspicious login attempts. They manually inspect logs, try to understand the events, investigate related activity and prepare a report for the client.

This takes time, and the investigation history may be spread across notes, terminal sessions and email.

### After Sentinel is integrated

1. The MSP signs up

   The owner creates an account, selects a plan, creates the MSP organization and invites an analyst.
2. The MSP creates a client workspace

   For example, a workspace named `Client A`. Its assets, events, alerts, cases and reports remain scoped to that client.
3. The MSP connects a server

   In the first version, the analyst uploads a supported log file. In the monitoring version, the analyst installs and enrolls the Sentinel agent on an authorized server.
4. Sentinel processes the events

   The parser extracts the available timestamps, usernames, source IP addresses and authentication outcomes. Malformed or unsupported lines are counted and reported.
5. A detection rule triggers

   Suppose a source IP produces repeated failed logins within a defined time window. Sentinel generates an alert containing the rule, time range and supporting event references.
6. The analyst investigates

   They inspect the evidence, review nearby events and request an AI explanation. Sentinel separates observed facts from hypotheses and unknowns.
7. The analyst creates a case

   They record the investigation notes, assign responsibility if supported, update the case status and document the outcome.
8. The MSP delivers a report

   It exports a report explaining what was observed, why the rule fired, what the analyst checked and what remains uncertain.
9. The MSP repeats this across its clients

   Once multi-client features exist, it can switch workspaces, monitor enrolled assets, review client-specific alerts and track its usage from one account.

The product helps the MSP investigate and document suspicious activity. It does not automatically prove that a server has been compromised, and it does not replace an appropriate incident-response process.

## 8. How NomaanOS Sentinel will earn money as a SaaS

The business model is a recurring subscription. Customers pay because they continue using Sentinel to monitor systems, investigate alerts, manage clients and prepare reports.

The uploaded plan proposes the following initial pricing hypotheses. These are prices to test with potential customers, not verified market rates.&#x20;

NomaanOS_Sentinel_Full_Project_Plan(1).docx



## Free

## ₹0

For evaluation and lead generation

- Synthetic demo and sample security alerts
- Limited uploads and event processing
- Explore the investigation workflow

  Purpose: let prospects understand the value before paying.

## Starter

## ₹999/mo

For individual administrators and small teams

- One workspace
- Monthly upload and event quotas
- Saved investigations
- Basic case-report exports

  Launch only after the core upload-and-investigate workflow is reliable.

## Pro

## ₹2,999/mo

For small businesses and busier IT teams

- Higher processing quotas
- Scheduled reports when implemented
- Longer retention within the plan's limits
- Alert notifications when implemented

  The value proposition should grow as monitoring and notification features become available.

## MSP

## ₹7,999/mo

For IT service providers managing multiple businesses

- Multiple client workspaces
- Consolidated alert and reporting views
- Usage visibility
- Client-scoped investigations and access

  Do not sell this as an operational MSP plan until its multi-client features exist and are tested.

### How a customer becomes revenue

1\. Find a potential customer

Contact MSP owners, IT consultants and small SaaS operators.

2\. Offer a free demonstration

Show a synthetic SSH attack scenario, evidence-backed alerts and a finished report.

3\. Run a supervised pilot

Test with a defined dataset and agreed data-handling rules.

4\. Convert to a paid subscription

Charge for the features and usage limits the customer actually needs.

5\. Retain and expand

Provide useful monitoring, investigation history, reports and client management month after month.

### How much could it earn?

Use the calculator below to explore gross monthly subscription revenue. The amounts are illustrative and exclude hosting, AI usage, payment fees, support, taxes, refunds and other costs.

Starter customers

### 10

0

50

100

₹999/month each

Pro customers

### 3

0

25

50

₹2,999/month each

MSP customers

### 2

0

12

25

₹7,999/month each

Illustrative gross monthly recurring revenue

# ₹34,985

Annualized gross revenue, assuming unchanged subscriptions

### ₹4,19,820

### How to keep the business profitable

We must measure:

- Hosting and database cost per workspace.
- Storage cost and retention volume.
- Cost per processed event or million events.
- AI cost per investigation, including retries.
- Email, payment and monitoring costs.
- Customer support time.
- Trial-to-paid conversion and cancellations.
- Gross margin per plan.

Do not promise unlimited log ingestion or unlimited AI analysis until actual usage costs are understood. We should validate demand with approximately 10–15 MSPs or IT consultants and aim for 2–3 hands-on pilots and at least one paid commitment before making a large investment in monitoring and MSP expansion.&#x20;

NomaanOS_Sentinel_Full_Project_Plan(1).docx



## 9. Security features required before accepting real customer logs

Because we are handling potentially sensitive server activity, security is a product requirement, not an optional feature for later.

Security readiness checklist

0/26

### Authentication and authorization

HTTPS/TLS everywhere

Secure session handling and password reset

Server-side authorization on every request

Tenant isolation tests

Role-based access control

Rate limiting for authentication and sensitive endpoints

### File and data security

Private storage for raw logs

Upload size, line-count and processing-time limits

Validation of file content rather than extension alone

Safe parsing and bounded processing

Redaction before AI requests

Configurable retention and tested deletion

Documented backup and recovery behavior

### AI safety

Logs treated as untrusted input

No arbitrary tools or commands available to the AI

Strict response-schema validation

Validate evidence references

Separate facts, hypotheses and unknowns

Limit model requests, latency and token usage

### Operational security

Secrets stored outside source control

Dependency scanning and automated security tests

Audit events for sensitive actions and exports

Credential revocation for enrolled agents

Monitoring of failed jobs and processing backlogs

Tested database restoration

Documented vulnerability-reporting and incident-response procedures

&#x20;Copy security checklist

Do not onboard real sensitive customer data until tenant-isolation tests pass, raw logs cannot be accessed publicly, processing retries are safe, secrets are protected, and AI evidence validation is working. Your plan identifies these as essential release gates.&#x20;

NomaanOS_Sentinel_Full_Project_Plan(1).docx



## 10. Full roadmap: what we build and in what order

The uploaded plan estimates approximately 4–6 weeks for a narrow solo-developer beta under favorable conditions. That is not an estimate for a complete, production-ready MSP platform with continuous monitoring and advanced integrations.&#x20;

NomaanOS_Sentinel_Full_Project_Plan(1).docx



Here is the practical sequence I recommend.

| Stage                 | Main deliverable                                                  | Completion test                                                         |
| --------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 0. Validate           | Customer interviews, scope, synthetic logs, threat model          | We know the initial buyer and use case                                  |
| 1. Core pipeline      | Upload endpoint, parser, normalized events, database              | Supported fixtures parse repeatably                                     |
| 2. Detections         | Versioned rules, alerts, evidence links, filters                  | Positive and negative tests pass                                        |
| 3. SaaS workflow      | Authentication, workspaces, cases, audit history and reports      | End-to-end investigation works with isolation tests                     |
| 4. AI and beta        | Evidence-grounded summaries, production deployment and demo       | Pilot users complete investigations independently                       |
| 5. Paid pilot         | Pricing, quotas, onboarding and support                           | At least one paid commitment or compelling demand evidence              |
| 6. Monitoring         | Linux agent, secure enrollment, ingestion, asset health           | Controlled monitoring pilot passes security tests                       |
| 7. MSP platform       | Client workspaces, roles, consolidated reports, usage and billing | Cross-client isolation and MSP workflows pass                           |
| 8. Advanced expansion | Selected integrations, SSO, advanced detection and scale          | Customer demand, security readiness and economics justify each addition |

### Recommended first 10 development sessions in Antigravity

1. Inspect the current repository, create the architecture document, threat-model draft and Git workflow.
2. Set up Docker Compose, the application skeleton, PostgreSQL and migrations.
3. Define the normalized event schema and create synthetic log fixtures.
4. Implement the first supported Linux authentication-log parser.
5. Add tests for timestamps, malformed lines, timezones and adversarial input.
6. Implement the first repeated-authentication-failure detection rule.
7. Add alert fingerprints, evidence links and idempotent processing.
8. Build the upload interface, processing status, alert list and alert details.
9. Add authentication, workspace-scoped authorization, cases and audit history.
10. Run end-to-end and security tests, demonstrate the workflow and interview prospective customers.

This follows the core implementation sequence in your project document.&#x20;

NomaanOS_Sentinel_Full_Project_Plan(1).docx



## 11. Final product completion criteria

Before we call the product an operational MSP platform, we should be able to verify the following end-to-end:

Final release checklist

Use this before declaring a release complete.

## 0/25

### MVP functionality

A new user can register and access an authorized workspace

A supported log file can be uploaded and processed

Parsing statistics and errors are visible

Alerts include rule details and supporting evidence

AI summaries distinguish facts, hypotheses and unknowns

Cases, notes, status changes and report exports work

Retention and deletion behave as documented

### Live monitoring

An authorized server can be enrolled securely

The agent sends events through authenticated transport

Network failures and retries do not silently lose events

Duplicate events do not create duplicate alerts

Agent health, last-seen status and revocation work

### MSP functionality

An MSP can create and manage multiple clients

Assets, alerts, cases and reports are scoped to each client

Roles and permissions are enforced on the backend

Usage is metered and plan limits are enforced

Billing events are verified and subscription changes are handled

Cross-client isolation tests pass

### Production readiness

Automated tests and security checks pass

Backups and recovery have been tested

Processing and AI failures are visible and recoverable

Secrets are protected and audit records are maintained

Privacy, retention and AI-provider usage are documented

Pilot users can complete the workflow without developer help

The business has evidence of willingness to pay

&#x20;Copy final release checklist

These criteria combine the MVP definition of done, agent safeguards, MSP expansion and production release gates from your uploaded plan.&#x20;

## My final recommendation

Build NomaanOS Sentinel in this order:

1. First, create a reliable upload-based investigation SaaS. Make parsing, deterministic detections, evidence-linked alerts, AI explanations, cases and reports work together.
2. Second, get pilot customers and validate the subscription model. Do not build a complex monitoring platform before we know that the core product solves a real problem.
3. Third, build the Linux agent and secure ingestion system. This creates the foundation for continuous monitoring and stronger recurring value.
4. Fourth, add the real MSP experience. Multi-client workspaces, permissions, consolidated reporting, usage tracking and billing are what turn the product into a platform for managed service providers.
5. Finally, add advanced integrations and enterprise controls based on actual customer demand.

The most important distinction is that file upload is our starting point, not the whole business. A PDF/log upload tool can demonstrate the technology, but a useful recurring-revenue MSP service needs ongoing operational value, secure integrations, client isolation, reliable investigations and reports that save the customer time.

We should build the foundation once and progressively unlock these capabilities, rather than attempting to build every advanced feature before the first customer can use the product.


---
# NomaanOS Sentinel — 15-Day Build Plan

We will use this as our 15-day execution roadmap in Google Antigravity, with a daily task list, the features to implement, the tests to run, and a final checklist to verify what is actually finished.

One important expectation: building the complete commercial-grade MSP platform—including a secure Linux agent, live monitoring, multi-client management, billing, advanced integrations and enterprise controls—in 15 days is extremely ambitious, especially for a solo developer. We can aim for a working end-to-end platform with a tightly scoped monitoring agent and MSP foundation, while clearly identifying anything that still needs production hardening.

The rule for this project: a feature is not complete because Antigravity generated its code or the page looks correct. It is complete when it works, has been tested, and passes its acceptance criteria.

## Our 15-day roadmap at a glance

### 01

Repository and architecture

Inspect existing code, establish the stack, database and development environment.

### 02

Authentication and workspaces

Accounts, sessions, workspace membership and backend authorization.

### 03

Upload and processing pipeline

Secure log uploads, processing jobs and status tracking.

### 04

Linux log parser

Parse supported authentication logs into normalized events.

### 05

Detection engine

Implement and test versioned detection rules and evidence links.

### 06

Security dashboard

Event explorer, alerts, filtering and alert details.

### 07

Cases and reports

Investigation workflow, notes, history and exports.

### 08

AI investigation assistant

Evidence-grounded explanations, schema validation and safe suggestions.

### 09

Security hardening

Tenant isolation, upload safety, audit history, retention and deletion.

### 10

Production-like MVP

End-to-end tests, error handling, staging and working demo.

### 11

Linux monitoring agent

Agent prototype, secure enrollment and selected log collection.

### 12

Live ingestion and alerts

Authenticated event batches, retry handling, heartbeat and email notifications.

### 13

MSP multi-client platform

Client workspaces, roles, asset views and client-scoped investigations.

### 14

Billing and integrations

Subscription flow, quotas, webhook foundations and deployment automation.

### 15

Final verification and release

Regression, security, recovery, onboarding and feature-by-feature acceptance.

The sequence deliberately puts the log-processing and detection engine before advanced integrations. This follows the core architecture of your existing project plan.&#x20;

## Day-by-day implementation plan

Each day has four things: what to build, how to verify it, what to ask Antigravity to do, and what must be checked off before moving forward.

## Day 1 — Repository, architecture and development environment

Goal: establish the foundation without breaking or unnecessarily replacing any existing work.

Tasks:

- Inspect the current repository and existing code.
- Confirm the frontend, backend, parser and database structure.
- Set up Git, `.gitignore` and `.env.example`.
- Set up Docker Compose for local development.
- Configure PostgreSQL and database migrations.
- Add health-check endpoints and structured application logs.
- Define the normalized security-event schema.
- Create synthetic Linux authentication logs for testing.
- Document the architecture and initial threat model.

Acceptance test: the application starts from the documented commands, the database connects, migrations run, and synthetic fixtures are available.

Day 1 — NomaanOS Sentinel foundation

Inspect the existing repository before making changes. Do not overwrite working code or assume the project is empty. Document the current state and identify missing components.

Set up the agreed stack: Next.js, React, TypeScript, Node.js/Express, Python for parsing and detection, PostgreSQL, and Docker Compose.

Create the repository structure, environment template, database migration setup, health checks, synthetic Linux authentication-log fixtures, normalized event schema, and initial threat model.

Run the application and database locally. Add appropriate tests and document the commands required to reproduce the setup.

At the end, provide a report listing files created or changed, commands executed, test results, unresolved issues, and the acceptance criteria that remain incomplete. Never claim a test passed unless you ran it.

## Day 2 — Authentication, users and workspaces

Goal: establish the identity and authorization system that every other feature will use.

- Registration and sign-in.
- Email verification and password reset.
- Secure sessions, logout and expiration.
- Create a workspace for the user.
- Store workspace memberships.
- Implement owner, admin, analyst and viewer permissions.
- Enforce workspace authorization in backend routes.
- Add tests for unauthorized and cross-workspace requests.

Acceptance test: users can access only the workspaces and resources for which they have permission.

Day 2 — Authentication and workspace security

Implement registration, sign-in, logout, secure session handling, email verification and password reset using a trusted authentication approach.

Implement workspace creation, workspace membership and role-based permissions. Enforce authorization on the server for every protected route and database operation.

Add automated tests for unauthenticated access, unauthorized role actions, expired sessions and attempts to access another workspace's resources.

Do not store plaintext passwords, expose secrets or rely on frontend-only permission checks. Run the tests and report verified results before completing this task.

## Day 3 — Secure file upload and processing pipeline

Goal: allow a user to upload supported logs and see exactly what happened.

- Build the upload page with a file picker and drag-and-drop.
- Document accepted file formats and limits.
- Validate file size, content and encoding.
- Create dataset records and upload status.
- Store raw logs privately.
- Create background processing jobs.
- Show queued, processing, completed and failed states.
- Add retry handling and duplicate-job protection.
- Display errors without exposing sensitive content.

Acceptance test: a valid test log reaches the processing pipeline; invalid and oversized files are rejected safely; processing failures remain visible.

Day 3 — Upload and processing

Build the complete supported-log upload workflow. Implement authenticated upload endpoints, private storage, dataset records, file validation, processing states, background job execution, safe retries and duplicate-job prevention.

Enforce upload-size, line-count and processing-time limits. Do not trust user-supplied filenames or paths. Make all dataset queries workspace-scoped.

Display clear progress and error states in the frontend. Test valid uploads, invalid content, oversized files, interrupted uploads, failed jobs and repeated processing requests.

Do not proceed until the upload workflow is functional and its tests pass.

## Day 4 — Linux authentication-log parser

Goal: turn raw log lines into structured security events.

- Implement the first documented Linux authentication-log format.
- Extract available timestamps, host, process, username, source IP and outcome.
- Normalize timestamps to UTC where possible.
- Preserve source-line references.
- Track parser version and dataset hash.
- Count valid, malformed and unsupported lines.
- Handle timezones, missing fields and malformed timestamps.
- Add unit tests using synthetic fixtures.

Acceptance test: known input files produce the expected normalized events consistently.

Day 4 — Linux log parser

Implement a tested Python parser for the selected Linux authentication-log format. Do not claim universal Linux log support.

Normalize parsed records into the canonical event schema. Preserve source-line references, timestamp uncertainty, parser version and dataset identity. Report valid, skipped, malformed and unsupported lines separately.

Create positive, negative, timezone, missing-field, malformed-input and adversarial-input tests using synthetic fixtures.

Connect the parser to the upload processing pipeline and verify that normalized events are persisted with the correct workspace and dataset identifiers.

## Day 5 — Deterministic detection engine

Goal: generate repeatable alerts with traceable evidence.

- Detect repeated authentication failures within a defined time window.
- Detect a successful login after repeated failures.
- Detect supported privileged-account activity.
- Implement additional detections only where the parser supplies sufficient evidence.
- Version the rules and document thresholds.
- Calculate alert fingerprints.
- Link every alert to supporting event IDs.
- Implement deduplication and safe reprocessing.
- Test false positives, negative cases and boundary conditions.

Acceptance test: the same dataset and rule versions produce repeatable results, and every generated alert can be traced to actual evidence.

Day 5 — Detection engine

Implement a deterministic, versioned detection engine in Python.

Start with repeated authentication failures, successful authentication following repeated failures, and supported privileged-account activity. Document each rule's prerequisites, threshold, time window, severity rationale and limitations.

Store alert fingerprints, rule versions, supporting event IDs and relevant timestamps. Ensure that reprocessing does not silently create duplicate alerts.

Add positive, negative, boundary, regression and false-positive tests. Do not use an LLM to decide whether deterministic rules fired. Report which rules are genuinely implemented and which remain pending.

## Day 6 — Dashboard, events and alert investigation

Goal: make the results useful to a real analyst.

- Build an overview dashboard using real database results.
- Display alerts by severity and status.
- Create the alert list and alert-detail pages.
- Build a paginated event explorer.
- Add search by host, username and source IP.
- Add filters for severity, rule, status and time range.
- Display rule explanations and supporting events.
- Add empty, loading and error states.
- Test all queries against workspace permissions.

Acceptance test: an analyst can move from an alert to its supporting events without losing context or seeing another workspace's data.

Day 6 — Security dashboard

Build the dashboard, alert list, alert detail and event explorer using actual API and database data. Do not use hardcoded demo counts as production results.

Implement pagination, date filtering, severity and status filters, search by host, username and source IP, and navigation from alerts to their supporting events.

Show detection rule details, timestamps, severity rationale, source references and processing limitations.

Add loading, empty and failure states. Test that all filters and detail routes enforce server-side workspace authorization.

## Day 7 — Cases, investigation history and reports

Goal: turn individual alerts into documented investigations.

- Create cases from alerts.
- Add investigation notes.
- Update case status.
- Assign cases to authorized team members.
- Record status changes and timestamps.
- Link cases to alerts and evidence.
- Export a structured investigation report.
- Include scope, timeframe, findings, notes and caveats.
- Test export permissions and report accuracy.

Acceptance test: a complete investigation can be documented, revisited and exported without losing its evidence references.

Day 7 — Investigation cases and reports

Implement cases, notes, case status changes, assignment, audit history and report exports.

Each case must reference the relevant workspace and supporting alerts. Restrict edits and assignments according to role permissions.

Generate reports containing the investigation scope, time range, detection rules, evidence references, findings, analyst notes, timestamps and explicit limitations.

Test report contents against stored data, unauthorized exports, empty cases, large notes and invalid identifiers. Ensure that generated reports cannot expose another workspace's data.

## Day 8 — AI investigation assistant

Goal: use AI to explain evidence without replacing the detection engine.

- Implement a provider adapter.
- Supply only the minimum relevant evidence.
- Redact sensitive values where appropriate.
- Produce structured summaries.
- Separate observed facts, hypotheses and unknowns.
- Validate every cited event ID.
- Generate safe, read-only investigation suggestions.
- Draft client-facing case summaries.
- Add timeout, failure and quota handling.
- Test prompt injection and fabricated evidence.

Acceptance test: if the AI provider fails, returns invalid output or cites nonexistent events, the application handles the failure safely and preserves the original evidence.

Day 8 — Evidence-grounded AI

Implement the AI investigation assistant behind a provider adapter. Give the model only the authorized, relevant and minimized evidence needed for the requested investigation.

Require structured output separating observed facts, hypotheses, unknowns, supporting event IDs and suggested safe investigation checks.

Validate the response schema and every referenced event ID against the authorized evidence set. Treat log contents as untrusted data, test prompt injection and prevent arbitrary command execution or tool use.

Implement timeouts, error handling, rate limits, usage metering and appropriate redaction. Never allow AI output to manufacture an alert or overwrite source evidence. Add tests for invalid JSON, nonexistent IDs, unsupported claims and provider failure.

## Day 9 — Security hardening and SaaS administration

Goal: make the upload-based product safe enough for controlled pilot testing.

- Review all API authorization.
- Test tenant isolation.
- Verify private raw-log storage.
- Implement audit records for sensitive actions.
- Enforce retention and deletion policies.
- Add usage limits for uploads, events and AI.
- Protect authentication and sensitive endpoints with rate limits.
- Configure secret management.
- Scan dependencies and check for leaked credentials.
- Test failed-job recovery and database backups.

Acceptance test: security tests pass, sensitive files are not publicly accessible, and deletion and recovery behavior match documented policies.

Day 9 — Security and SaaS administration

Perform a security review of authentication, authorization, uploads, storage, background processing, exports, AI requests and audit records.

Implement and test retention, deletion, quotas, rate limits and sensitive-action auditing. Verify that raw logs are stored privately and that secrets are not committed to source control.

Add dependency and secret scanning. Test cross-workspace access attempts, malicious filenames, oversized files, processing retries, deletion behavior and backup restoration.

Record every unresolved security issue. Do not onboard real sensitive customer data if critical authorization, storage, credential or data-deletion problems remain.

## Day 10 — End-to-end MVP and staging deployment

Goal: have the first usable product running as one connected system.

- Deploy a staging environment.
- Configure environment-specific credentials.
- Run database migrations.
- Run frontend, backend and parser tests.
- Run the complete upload-to-report workflow.
- Verify AI failures do not break investigations.
- Add operational health checks and error monitoring.
- Test backup restoration.
- Create a synthetic demo workspace.
- Document setup and troubleshooting.

Acceptance test: a new test user can complete the entire investigation workflow without developer intervention.

Day 10 — MVP release candidate

Prepare a staging deployment of the upload-based NomaanOS Sentinel product.

Run formatting, linting, type checks, parser tests, detection tests, API integration tests, browser tests and security tests. Exercise the full workflow from registration to upload, parsing, alert creation, AI explanation, case management and report export.

Verify migration behavior, backup restoration, processing retries, health checks and operational error reporting.

Create a synthetic demo workflow and user documentation. Produce a release report listing passed tests, failed tests, unresolved issues and the exact features ready for pilot use. Do not label the system production-ready solely because it deploys successfully.

## Day 11 — Linux monitoring agent

Goal: build the first working path toward continuous monitoring.

- Select the first supported Linux distribution.
- Implement the agent's configuration and service lifecycle.
- Implement one-time, expiring enrollment tokens.
- Issue a distinct credential to each agent.
- Collect only the selected authentication logs.
- Assign a stable asset identifier.
- Implement bounded local buffering.
- Implement safe installation and uninstallation.
- Document minimum required permissions.
- Test credential revocation.

Acceptance test: an authorized test server can enroll and collect the selected events without granting the service unnecessary privileges.

Day 11 — Linux agent prototype

Inspect the existing ingestion architecture and implement a minimal Linux monitoring agent for one documented, tested distribution.

Implement secure enrollment using short-lived, single-use tokens and issue distinct revocable credentials per agent. Collect only the explicitly selected authentication logs, maintain stable asset identity and use bounded local buffering.

Provide safe configuration, service startup, shutdown, uninstall instructions and documented permissions. Do not implement remote shell execution, automatic account disabling, firewall changes or arbitrary remediation.

Run tests in an isolated Linux environment. If no suitable environment is available, report the agent as unverified rather than claiming successful deployment.

## Day 12 — Live ingestion, agent health and notifications

Goal: make agent events enter the same pipeline as uploaded files.

- Build authenticated batch-ingestion endpoints.
- Validate agent credentials and asset ownership.
- Use TLS for event transmission.
- Validate batches and event sequence identifiers.
- Add retries with backoff.
- Prevent duplicate processing.
- Add heartbeats and last-seen timestamps.
- Show agent version and health.
- Add credential revocation and failed-batch reporting.
- Implement configurable email alert notifications.

Acceptance test: a test agent sends events, the dashboard shows the resulting alerts, and network interruptions do not cause silent data loss.

Day 12 — Agent ingestion and monitoring

Connect the Linux agent to the existing backend ingestion pipeline. Authenticate every batch, verify the agent's asset and workspace ownership, validate event structure and reject unauthorized or replayed requests.

Implement bounded retries, backoff, deduplication, heartbeat, last-seen status, delivery-lag monitoring, failed-batch visibility and credential revocation.

Add configurable email notifications with delivery status and retry handling.

Run an end-to-end test with an enrolled Linux test server. Disconnect the network temporarily, restore it and verify the documented buffering and recovery behavior. Report any remaining delivery guarantees or limitations explicitly.

## Day 13 — MSP multi-client operations

Goal: enable one MSP organization to manage multiple client environments securely.

- Create the MSP organization model.
- Create and manage client workspaces.
- Add client switching.
- Add MSP owner, admin, analyst and viewer permissions.
- Associate assets with the correct client.
- Add client-scoped alert and case views.
- Add consolidated alert summaries.
- Add client-specific reports.
- Add per-client usage metrics.
- Test cross-client isolation thoroughly.

Acceptance test: the MSP can manage at least two test clients from one organization, and no unauthorized user can access the other client's records.

Day 13 — MSP multi-client platform

Implement the MSP organization and client-workspace model on top of the existing workspace architecture.

Add client switching, MSP roles, client-scoped assets, alerts, cases, reports and usage summaries. Ensure that authorized MSP staff can view assigned clients without granting clients access to each other's information.

Enforce authorization at the API and database layers. Add automated negative tests for cross-client access to events, raw datasets, alert details, cases, report exports and agent credentials.

Test workflows with at least two separate synthetic clients. Do not consider the MSP feature complete until the isolation tests pass.

## Day 14 — Billing, webhooks and deployment automation

Goal: establish the commercial foundations and the first external integration mechanisms.

- Implement plan definitions and entitlements.
- Enforce quotas on the server.
- Integrate a payment provider appropriate for the target market.
- Implement subscription lifecycle handling.
- Verify payment webhooks.
- Make webhook handlers idempotent.
- Implement signed outbound security-alert webhooks.
- Add webhook delivery logs and retries.
- Automate testing and staging deployments.
- Document production configuration and rollback.

Acceptance test: plan limits are enforced server-side, subscription events are verified, and webhook failures are visible and recoverable.

Day 14 — Commercial and integration foundations

Implement subscription plans, entitlements, server-side usage limits and the selected payment provider's verified subscription lifecycle.

Validate provider webhook signatures and handle duplicate deliveries idempotently. Implement signed outbound alert webhooks with timestamps, replay protection, delivery logs, retries, timeouts and secret rotation.

Automate formatting, linting, tests, security scans and staging deployment. Document production secrets, database migrations, rollback and recovery procedures.

Test successful payments, failed payments, cancellations, duplicate billing events, exceeded quotas and failed outbound webhooks. Keep subscription status and access enforcement consistent.

## Day 15 — Final verification and release decision

Goal: establish exactly what works, what is incomplete and whether the release is safe for its intended use.

- Run all unit, integration and end-to-end tests.
- Repeat the full upload-to-report workflow.
- Verify agent enrollment and live ingestion.
- Verify multi-client MSP operations.
- Verify subscription and webhook behavior.
- Re-run cross-tenant authorization tests.
- Restore a backup in a test environment.
- Verify deletion and retention policies.
- Verify AI evidence validation and prompt-injection defenses.
- Test application and worker recovery.
- Document known limitations.
- Create the release checklist and deployment notes.
- Confirm whether the product is a demo, controlled beta or production-ready release.

Acceptance test: every claimed feature has a verifiable test result, and all critical security release gates pass.

Day 15 — Final release audit

Audit the entire NomaanOS Sentinel repository and deployed staging environment against the feature checklist and acceptance criteria.

Run the complete automated test suite and end-to-end workflows for upload analysis, deterministic detections, evidence-grounded AI, case management, report export, Linux agent enrollment, live ingestion, agent health, MSP client isolation, subscriptions and webhooks.

Test unauthorized access, malicious uploads, invalid AI evidence references, prompt injection, failed jobs, duplicate processing, network interruptions, credential revocation, data deletion and backup restoration.

Create a final feature matrix with these exact statuses:

1. PASS — implemented and verified by a reproducible test.
2. PARTIAL — implemented but incomplete or insufficiently tested.
3. FAIL — attempted but the acceptance criteria failed.
4. NOT IMPLEMENTED — no working implementation exists.
5. BLOCKED — requires unavailable infrastructure, credentials or external configuration.

For every item, provide the evidence, test command or manual verification procedure. List unresolved vulnerabilities, deployment risks and unsupported features. Do not mark a feature PASS because a UI page exists or code was generated.

Make the final release recommendation based on evidence. If any critical security gate fails, do not recommend onboarding real sensitive customer data.

## 12. Final master tracker — all 15 days in one place

The daily plans above define what must be built. Use this final tracker to see the overall progress. Check an item only after verifying its acceptance criteria.

## 15-day completion tracker

45 acceptance checks across all development days

# 0/45

DAY 1

Foundation

0/3

Repository and architecture documented

Local stack and database start successfully

Schema and synthetic fixtures exist

DAY 2

Authentication

0/3

Authentication and sessions work

Workspace and role authorization enforced

Unauthorized-access tests pass

DAY 3

Uploads

0/3

Secure uploads work

Processing states and errors are visible

Retry and duplicate handling tested

DAY 4

Parser

0/3

Supported logs parse correctly

Normalized events and source references persist

Malformed input tests pass

DAY 5

Detections

0/3

Initial detection rules work

Alerts link to evidence

Regression and deduplication tests pass

DAY 6

Dashboard

0/3

Real alert and event views work

Search and filters work

Workspace permissions are enforced

DAY 7

Cases and reports

0/3

Cases and notes persist

Case history and assignment work

Reports contain correct evidence

DAY 8

AI assistant

0/3

Evidence-grounded summaries work

Output and evidence IDs are validated

AI failure and injection tests pass

DAY 9

Hardening

0/3

Tenant isolation verified

Retention and deletion tested

Secrets, storage and recovery reviewed

DAY 10

MVP release

0/3

Staging deployment works

End-to-end MVP test passes

Demo and operational documentation exist

DAY 11

Linux agent

0/3

Agent enrolls securely

Approved logs are collected

Permissions and revocation are tested

DAY 12

Live monitoring

0/3

Ingestion authenticates agents

Retries and heartbeat work

Notifications and failure visibility work

DAY 13

MSP platform

0/3

Multiple client workspaces work

Client-scoped operations work

Cross-client isolation tests pass

DAY 14

Commercial

0/3

Plans and server-side quotas work

Billing events are verified

Signed webhooks and CI checks work

DAY 15

Release audit

0/3

All test suites run

All feature statuses are evidence-based

Release decision and limitations documented

&#x20;Copy full 15-day tracker Copy status report

This tracker records your manual selections in the current interactive view. It does not automatically read the repository or run tests. A checked item still needs supporting test evidence.

## 13. How we will work together each day

At the beginning of each day, we will inspect the current repository and the previous day's results before asking Antigravity to make changes.

At the end of each day, we will:

1. Review which files changed.
2. Run the required tests.
3. Check the day's acceptance criteria.
4. Fix blocking failures before starting dependent work.
5. Record incomplete features rather than hiding them.
6. Commit the verified changes to Git.

If a day takes longer than planned, we should prioritize the core workflow and security over adding more screens or integrations.

One final distinction: this 15-day plan targets a broad, integrated first implementation. A production-ready MSP security product still requires additional time for real-world agent testing, security review, operational reliability, customer pilots and the advanced features that cannot responsibly be considered complete merely because their code exists.

Our first action is Day 1: inspect your current Antigravity project and establish the actual starting point. We should adapt the plan to existing working code rather than rebuild things unnecessarily.