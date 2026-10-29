# NomaanOS Sentinel — Visual End-to-End Testing Guide (Website UI)

This guide shows you how to test all features of NomaanOS Sentinel **visually directly through the website UI** (`http://localhost:3000`) and your **Mailtrap Sandbox dashboard**.

---

## 1. Linux Agent Integration — Can it really be done just by running the command?

**YES, 100% real and working.** The command shown on your screen is an actual live handshake that connects an agent to your workspace.

### Where to run the command:
Run it in any terminal (PowerShell, Command Prompt, or Linux / WSL terminal):

```bash
python -m sentinel_agent.cli enroll --token <YOUR_TOKEN_HERE> --api-url http://localhost:4000
```

*(Note: On Windows, use `python -m sentinel_agent.cli enroll ...`. On a real Ubuntu server, you use `sudo sentinel-agent enroll ...`)*

---

## 2. Visual Walkthrough: Testing Everything on the Website

### Step 1: Host Agent Connection (Live Visual Flip)
1. In your browser at `http://localhost:3000/workspaces/<workspace-id>`, go to **Integrations**.
2. Click on your integration (e.g. `test-int`).
3. Notice the status badge shows **Orange: `Pending Enrollment`**.
4. Click the blue **"Initiate Enrollment"** button to generate a fresh token and copy it.
5. In your terminal, run the enroll command with that token:
   ```bash
   python -m sentinel_agent.cli enroll --token sentinel_enroll_YOUR_TOKEN --api-url http://localhost:4000
   ```
6. **Watch the website:** Refresh the page.
   - Status badge instantly flips from **Orange (`Pending`)** to **Green (`Connected`)**!
   - **Agent Identity** updates from *"Awaiting enrollment"* to your live `Agent ID`.
   - **Last Verified Communication** updates with a live timestamp.

---

### Step 2: Live Security Event Ingestion & Threat Detection
To see events flow onto the website UI:
1. In your terminal, append a test security event:
   ```bash
   python -m sentinel_agent.cli test-log --message "Failed password for root from 198.51.100.42 port 22 ssh2"
   ```
2. Start the agent sender:
   ```bash
   python -m sentinel_agent.cli start
   ```
3. **On the Website:**
   - Go to **Security Events** in the sidebar.
   - You will see the event appear in real time: `ssh_login_failure`, Source IP: `198.51.100.42`, Username: `root`.
   - Repeat the command a few times to simulate a brute force attack.
   - Click on **Alerts** in the top navigation.
   - A new **High/Critical Security Alert** will pop up with the title:
     `SSH Brute Force Attack Detected`!

---

### Step 3: Mailtrap Real Email Delivery (Visual Check)
In your adjacent browser tab (**Mailtrap - Email Delivery Platform**):
1. Open your **Mailtrap Sandbox Inbox**.
2. Trigger an alert or click **Test Notification** in Workspace Settings -> Notifications.
3. Check your Mailtrap inbox:
   - You will see a newly arrived email:
     `[SECURITY ALERT] [HIGH] SSH Brute Force Attack Detected`
   - Open it: It contains the formatted dark cyber-defense card, severity badge, rule name, timestamp, and a direct button **"Open Investigation Console"** that links back to `http://localhost:3000`.

---

### Step 4: Outbound Webhooks & SSRF Protection (Visual Check)
1. On the website, go to your Workspace -> **Settings** -> **Webhooks**.
2. Click **Add Webhook**:
   - **Test 1 (SSRF Protection Visual Rejection)**:
     - Enter URL: `http://127.0.0.1:5432` or `http://169.254.169.254/latest/meta-data/`
     - Click **Save**.
     - **Visual Result**: The UI immediately displays an error banner:
       `Destination rejected: Internal or private IP addresses are blocked for security (SSRF Protection).`
   - **Test 2 (Valid Webhook)**:
     - Enter a public test webhook URL (e.g. from `webhook.site`).
     - Click **Save**.
     - **Visual Result**: Webhook is saved and the signing secret is securely masked (`whsec_***`).
     - Click **Send Test Ping**: You will see a green checkmark `Test webhook delivered successfully` with HTTP status 200 and delivery latency.

---

### Step 5: Commercial Subscriptions & Quota Enforcement (Visual Check)
1. On the website, go to **Billing & Plans**.
2. You will see the active plan tiers: **Community / Free**, **Starter**, **Pro**, and **MSP Enterprise**.
3. **Visual Quota Gate Test**:
   - On the **Free** plan, your integration limit is `1 host agent`.
   - Try to click **Add Integration** to register a second host agent.
   - **Visual Result**: The UI catches the `HTTP 402 Payment Required` and displays:
     `Quota Exceeded: The Sentinel Community / Free plan allows up to 1 registered agent integration. Upgrade your plan to add more servers.`
   - Click **Upgrade Plan**: The Razorpay checkout dialog opens with the exact plan price!

---

## 3. Summary of Visual Verification Checklist

| What to verify | Where to look on Website | Expected Visual Result |
|---|---|---|
| **Agent Enrollment** | `/workspaces/:id` (Integrations tab) | Badge turns from orange `Pending Enrollment` to green `Connected` |
| **Telemetry Ingestion** | `/workspaces/:id/events` | Log table fills with live Linux auth events (`ssh_login_failure`) |
| **Detection Engine** | `/workspaces/:id/alerts` | Incident card appears with severity badge and evidence count |
| **Mailtrap Email** | Mailtrap Inbox tab | Formatted HTML alert email appears in real-time |
| **SSRF Webhook Block** | Settings -> Webhooks | Error banner blocks localhost and internal cloud metadata IPs |
| **Quota Enforcement** | Integrations / Billing | 402 Upgrade dialog appears when exceeding plan limits |

