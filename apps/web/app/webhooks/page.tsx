'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Zap,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  RefreshCw,
  Building,
  AlertCircle,
  Plus,
  Trash2,
  Edit,
  RotateCw,
  Send,
  Eye,
  Copy,
  Check,
  X,
  ExternalLink,
  ShieldAlert,
  Clock,
  History,
  Lock,
  LogOut,
  Info,
  CreditCard
} from 'lucide-react';
import {
  apiRequest,
  User,
  WorkspaceSummary,
  fetchWorkspaceWebhooks,
  createWorkspaceWebhook,
  updateWorkspaceWebhook,
  deleteWorkspaceWebhook,
  rotateWebhookSecret,
  testWorkspaceWebhook,
  fetchWebhookDeliveries,
  retryWebhookDelivery,
  fetchSubscriptionDetails,
  WebhookConfig,
  WebhookDeliveryRecord,
  isUserVerified,
  shouldDisplayVerificationWarning
} from '@/lib/api';

const AVAILABLE_RULES = [
  { id: 'AUTH_REPEATED_FAILURES', name: 'Repeated Authentication Failures' },
  { id: 'PRIV_ACCOUNT_ACTIVITY', name: 'Supported Privileged-Account Activity' },
  { id: 'AUTH_INVALID_USER_PROBING', name: 'Invalid User Probing' },
  { id: 'AUTH_SUCCESS_AFTER_FAILURES', name: 'Authentication Success After Failures' }
];

const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];

function WebhooksContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Selected workspace
  const [workspaceId, setWorkspaceId] = useState<string>('');
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);

  // Webhook list & Entitlements
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [planCanUseWebhooks, setPlanCanUseWebhooks] = useState<boolean>(true);
  const [planName, setPlanName] = useState<string>('Starter');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create Webhook Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newMinSeverity, setNewMinSeverity] = useState('low');
  const [newRules, setNewRules] = useState<string[]>([]);
  const [createLoading, setCreateLoading] = useState(false);

  // One-time Secret Display Modal
  const [revealedSecret, setRevealedSecret] = useState<{ name: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Edit Webhook Modal
  const [editingWebhook, setEditingWebhook] = useState<WebhookConfig | null>(null);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editMinSeverity, setEditMinSeverity] = useState('low');
  const [editRules, setEditRules] = useState<string[]>([]);
  const [editEnabled, setEditEnabled] = useState(true);
  const [editLoading, setEditLoading] = useState(false);

  // Delete Confirmation Modal
  const [deletingWebhook, setDeletingWebhook] = useState<WebhookConfig | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Secret Rotation Confirmation Modal
  const [rotatingWebhook, setRotatingWebhook] = useState<WebhookConfig | null>(null);
  const [rotateLoading, setRotateLoading] = useState(false);

  // Test Ping Modal & Result
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    webhookName: string;
    delivery: WebhookDeliveryRecord;
  } | null>(null);

  // Delivery Audit Drawer
  const [deliveryDrawerWebhook, setDeliveryDrawerWebhook] = useState<WebhookConfig | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryRecord[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<string | null>(null);

  // 1. Initial Load of Account and Workspaces
  useEffect(() => {
    async function loadWorkspaces() {
      setLoading(true);
      const meRes = await apiRequest<{ user: User; workspaces: WorkspaceSummary[] }>('/api/v1/auth/me');

      if (meRes.status === 401) {
        router.push('/login');
        return;
      }

      if (meRes.error || !meRes.data) {
        setError(meRes.error || 'Failed to authenticate');
        setLoading(false);
        return;
      }

      setUser(meRes.data.user);
      const wsList = meRes.data.workspaces || [];
      setWorkspaces(wsList);

      const queryWs = searchParams.get('workspaceId');
      if (queryWs && wsList.some((w) => w.id === queryWs)) {
        setWorkspaceId(queryWs);
      } else if (wsList.length > 0) {
        setWorkspaceId(wsList[0].id);
      }

      setLoading(false);
    }

    loadWorkspaces();
  }, [router, searchParams]);

  // 2. Fetch Webhooks & Check Plan Entitlement
  const loadWebhooks = useCallback(
    async (silent = false) => {
      if (!workspaceId) return;
      if (!silent) setRefreshing(true);

      const [hooksRes, subRes] = await Promise.all([
        fetchWorkspaceWebhooks(workspaceId),
        fetchSubscriptionDetails('workspace', workspaceId)
      ]);

      setRefreshing(false);

      if (hooksRes.data?.webhooks) {
        setWebhooks(hooksRes.data.webhooks);
      }

      if (subRes.data?.plan) {
        setPlanCanUseWebhooks(Boolean(subRes.data.plan.features.canUseOutboundWebhooks));
        setPlanName(subRes.data.plan.name);
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    if (workspaceId) {
      loadWebhooks();
    }
  }, [workspaceId, loadWebhooks]);

  // Current Workspace object
  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);
  const isOwnerOrAdmin = currentWorkspace?.role === 'owner' || currentWorkspace?.role === 'admin';

  // Create Webhook Submit
  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !newName.trim() || !newUrl.trim()) return;

    setCreateLoading(true);
    setActionMessage(null);

    const res = await createWorkspaceWebhook(workspaceId, {
      name: newName.trim(),
      url: newUrl.trim(),
      minSeverity: newMinSeverity,
      subscribedRules: newRules
    });

    setCreateLoading(false);

    if (res.error) {
      setActionMessage({ type: 'error', text: res.error });
      return;
    }

    setShowCreateModal(false);
    setNewName('');
    setNewUrl('');
    setNewRules([]);

    // Reveal one-time signing secret
    if (res.data?.webhook.signingSecret) {
      setRevealedSecret({
        name: res.data.webhook.name,
        secret: res.data.webhook.signingSecret
      });
    }

    setActionMessage({ type: 'success', text: `Webhook '${res.data?.webhook.name}' created successfully.` });
    await loadWebhooks(true);
  };

  // Edit Webhook Submit
  const handleEditWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !editingWebhook) return;

    setEditLoading(true);
    setActionMessage(null);

    const res = await updateWorkspaceWebhook(workspaceId, editingWebhook.id, {
      name: editName.trim(),
      url: editUrl.trim(),
      minSeverity: editMinSeverity,
      subscribedRules: editRules,
      enabled: editEnabled
    });

    setEditLoading(false);
    setEditingWebhook(null);

    if (res.error) {
      setActionMessage({ type: 'error', text: res.error });
      return;
    }

    setActionMessage({ type: 'success', text: `Webhook configuration updated successfully.` });
    await loadWebhooks(true);
  };

  // Toggle Enable/Disable Inline
  const handleToggleEnable = async (hook: WebhookConfig) => {
    if (!workspaceId || !isOwnerOrAdmin) return;
    const res = await updateWorkspaceWebhook(workspaceId, hook.id, {
      enabled: !hook.enabled
    });
    if (res.error) {
      setActionMessage({ type: 'error', text: res.error });
    } else {
      await loadWebhooks(true);
    }
  };

  // Rotate Signing Secret Submit
  const handleConfirmRotate = async () => {
    if (!workspaceId || !rotatingWebhook) return;

    setRotateLoading(true);
    const res = await rotateWebhookSecret(workspaceId, rotatingWebhook.id);
    setRotateLoading(false);
    const targetHook = rotatingWebhook;
    setRotatingWebhook(null);

    if (res.error) {
      setActionMessage({ type: 'error', text: res.error });
      return;
    }

    if (res.data?.signingSecret) {
      setRevealedSecret({
        name: targetHook.name,
        secret: res.data.signingSecret
      });
    }

    setActionMessage({ type: 'success', text: `Signing secret rotated successfully.` });
    await loadWebhooks(true);
  };

  // Delete Webhook Submit
  const handleConfirmDelete = async () => {
    if (!workspaceId || !deletingWebhook) return;

    setDeleteLoading(true);
    const res = await deleteWorkspaceWebhook(workspaceId, deletingWebhook.id);
    setDeleteLoading(false);
    setDeletingWebhook(null);

    if (res.error) {
      setActionMessage({ type: 'error', text: res.error });
      return;
    }

    setActionMessage({ type: 'success', text: 'Webhook deleted successfully.' });
    await loadWebhooks(true);
  };

  // Test Webhook Ping
  const handleTestPing = async (hook: WebhookConfig) => {
    if (!workspaceId) return;
    setTestingWebhookId(hook.id);

    const res = await testWorkspaceWebhook(workspaceId, hook.id);
    setTestingWebhookId(null);

    if (res.error) {
      setActionMessage({ type: 'error', text: `Test ping error: ${res.error}` });
      return;
    }

    if (res.data?.delivery) {
      setTestResult({
        webhookName: hook.name,
        delivery: res.data.delivery
      });
    }
  };

  // Open Delivery History Drawer
  const handleOpenDeliveries = async (hook: WebhookConfig) => {
    if (!workspaceId) return;
    setDeliveryDrawerWebhook(hook);
    setDeliveriesLoading(true);

    const res = await fetchWebhookDeliveries(workspaceId, hook.id, 50, 0);
    setDeliveriesLoading(false);

    if (res.data?.deliveries) {
      setDeliveries(res.data.deliveries);
    }
  };

  // Retry Failed Delivery
  const handleRetryDelivery = async (deliveryId: string) => {
    if (!workspaceId || !deliveryDrawerWebhook) return;
    setRetryingDeliveryId(deliveryId);

    const res = await retryWebhookDelivery(workspaceId, deliveryDrawerWebhook.id, deliveryId);
    setRetryingDeliveryId(null);

    if (res.error) {
      setActionMessage({ type: 'error', text: `Retry failed: ${res.error}` });
      return;
    }

    // Refresh deliveries list
    const updated = await fetchWebhookDeliveries(workspaceId, deliveryDrawerWebhook.id, 50, 0);
    if (updated.data?.deliveries) {
      setDeliveries(updated.data.deliveries);
    }
    setActionMessage({
      type: res.data?.delivery.status === 'delivered' ? 'success' : 'error',
      text: res.data?.delivery.status === 'delivered' ? 'Retry delivered successfully!' : 'Retry attempted but failed.'
    });
  };

  // Copy Secret helper
  const handleCopySecret = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Main Navigation Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/workspaces"
              className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Directory</span>
            </Link>
            <div className="h-4 w-px bg-slate-800" />
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400 shadow-sm shadow-cyan-900/30">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-white">Outbound Webhooks</h1>
                <p className="text-[11px] text-slate-400">Real-time HMAC alert forwarding to SIEM, SOAR, & SecOps</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {/* Quick nav to Billing */}
            <Link
              href={workspaceId ? `/billing?workspaceId=${workspaceId}` : '/billing'}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors"
            >
              <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
              <span>Billing</span>
            </Link>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
              <span className="text-slate-500">User:</span>
              <span className="font-medium text-slate-200">{user?.email}</span>
            </div>

            <button
              onClick={() => {
                apiRequest('/api/v1/auth/logout', { method: 'POST' }).then(() => router.push('/login'));
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Workspace Scope Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-slate-400">Workspace Scope:</span>
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-xs rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.role.toUpperCase()})
                </option>
              ))}
            </select>

            <button
              onClick={() => loadWebhooks()}
              disabled={refreshing}
              className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors disabled:opacity-50"
              title="Refresh Webhooks"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} />
            </button>
          </div>

          <div>
            <button
              onClick={() => setShowCreateModal(true)}
              disabled={!planCanUseWebhooks || !isOwnerOrAdmin}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md shadow-cyan-950/40 transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>Add Webhook Endpoint</span>
            </button>
          </div>
        </div>

        {/* Action Message Banner */}
        {actionMessage && (
          <div
            className={`p-4 rounded-xl flex items-center justify-between text-xs border ${
              actionMessage.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-200'
                : 'bg-rose-950/60 border-rose-800/80 text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {actionMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{actionMessage.text}</span>
            </div>
            <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Plan Quota Blocked Notice (if Free plan) */}
        {!planCanUseWebhooks && (
          <div className="p-5 rounded-2xl bg-amber-950/40 border border-amber-800/60 text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-sm font-semibold text-white block mb-0.5">
                  Outbound Webhooks Require Starter, Pro, or MSP Plan
                </strong>
                <span>
                  The current workspace is on the <strong>{planName}</strong> tier, which does not include outbound
                  alert webhook forwarding. Upgrade your subscription to connect SIEMs, Splunk, Datadog, or Slack.
                </span>
              </div>
            </div>
            <Link
              href={workspaceId ? `/billing?workspaceId=${workspaceId}` : '/billing'}
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs shrink-0 transition-colors flex items-center gap-1.5"
            >
              <span>View Plans & Upgrade</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {/* Security & Architecture Info Callout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 text-xs text-slate-300">
            <div className="flex items-center gap-2 text-cyan-400 font-semibold mb-1">
              <Lock className="w-4 h-4" />
              <span>HMAC-SHA256 Signing</span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Every delivery includes an <code>X-Sentinel-Signature</code> header (<code>t=timestamp,v1=hash</code>)
              allowing recipients to verify authenticity and prevent replays.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 text-xs text-slate-300">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-1">
              <ShieldCheck className="w-4 h-4" />
              <span>SSRF Defense Engine</span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Pre-flight DNS and IP validation blocks internal loopback (127.0.0.1), RFC1918 private ranges, and cloud
              metadata endpoints (169.254.169.254).
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 text-xs text-slate-300">
            <div className="flex items-center gap-2 text-amber-400 font-semibold mb-1">
              <History className="w-4 h-4" />
              <span>Automatic Retries & Audit</span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Failed deliveries automatically retry with exponential backoff (up to 3 attempts), and all requests,
              latencies, and response snippets are auditable.
            </p>
          </div>
        </div>

        {/* Webhooks List Table */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white">Configured Endpoints ({webhooks.length})</h2>
              <p className="text-xs text-slate-400">Active HTTP destinations receiving normalized security alerts</p>
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              <p className="text-xs">Loading webhook configurations...</p>
            </div>
          ) : webhooks.length === 0 ? (
            <div className="p-12 rounded-2xl bg-slate-900/40 border border-slate-800/80 text-center space-y-3">
              <div className="inline-flex p-3 rounded-full bg-slate-800/60 text-slate-400">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-white">No Outbound Webhooks Configured</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Forward security alerts to your SIEM, SOAR, incident response system, or custom API endpoints in
                real-time.
              </p>
              {planCanUseWebhooks && isOwnerOrAdmin && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors"
                >
                  Create Your First Webhook
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {webhooks.map((hook) => (
                <div
                  key={hook.id}
                  className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-slate-700/80 transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-2 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-sm font-bold text-white">{hook.name}</h3>
                      <button
                        onClick={() => handleToggleEnable(hook)}
                        disabled={!isOwnerOrAdmin}
                        className={`text-[10px] font-semibold uppercase px-2.5 py-0.5 rounded-full border transition-colors ${
                          hook.enabled
                            ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60 hover:bg-emerald-900/60'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                        }`}
                      >
                        {hook.enabled ? 'Enabled' : 'Disabled'}
                      </button>

                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-cyan-400">
                        Min: {hook.minSeverity.toUpperCase()}
                      </span>

                      {hook.subscribedRules.length === 0 ? (
                        <span className="text-[10px] text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          All Rules Subscribed
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          {hook.subscribedRules.length} Specific Rule(s)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs font-mono text-slate-300 break-all">
                      <span className="text-slate-500">URL:</span>
                      <span className="text-cyan-300">{hook.url}</span>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-slate-400 flex-wrap">
                      <span>Secret: <code>{hook.signingSecretMasked}</code></span>
                      <span>•</span>
                      <span>
                        Rotated: {new Date(hook.secretLastRotatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start lg:self-center shrink-0 flex-wrap">
                    <button
                      onClick={() => handleTestPing(hook)}
                      disabled={testingWebhookId === hook.id}
                      className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 hover:text-white transition-colors flex items-center gap-1.5"
                      title="Send signed test ping"
                    >
                      {testingWebhookId === hook.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                      ) : (
                        <Send className="w-3.5 h-3.5 text-cyan-400" />
                      )}
                      <span>Test Ping</span>
                    </button>

                    <button
                      onClick={() => handleOpenDeliveries(hook)}
                      className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 hover:text-white transition-colors flex items-center gap-1.5"
                    >
                      <History className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Deliveries</span>
                    </button>

                    {isOwnerOrAdmin && (
                      <>
                        <button
                          onClick={() => {
                            setEditingWebhook(hook);
                            setEditName(hook.name);
                            setEditUrl(hook.url);
                            setEditMinSeverity(hook.minSeverity);
                            setEditRules(hook.subscribedRules);
                            setEditEnabled(hook.enabled);
                          }}
                          className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition-colors"
                          title="Edit Webhook"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => setRotatingWebhook(hook)}
                          className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-amber-400 transition-colors"
                          title="Rotate Signing Secret"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => setDeletingWebhook(hook)}
                          className="p-2 rounded-xl bg-slate-950 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900/60 text-slate-400 hover:text-rose-400 transition-colors"
                          title="Delete Webhook"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* CREATE WEBHOOK MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-bold text-white">Create Outbound Webhook Endpoint</h3>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateWebhook} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 font-medium mb-1">Webhook Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Primary Splunk HEC / Slack SOC Alert Bot"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Destination URL (HTTPS) *</label>
                <input
                  type="url"
                  required
                  placeholder="https://siem.internal-soc.com/api/v1/webhook"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono text-[11px]"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Protected by SSRF firewall. Localhost, 127.0.0.1, RFC1918 private subnets, and link-local ranges are
                  safely rejected.
                </p>
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Minimum Alert Severity</label>
                <select
                  value={newMinSeverity}
                  onChange={(e) => setNewMinSeverity(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 capitalize"
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s.toUpperCase()} (and higher)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1.5">
                  Subscribed Detection Rules (Optional filter)
                </label>
                <div className="space-y-2 p-3 rounded-xl bg-slate-950 border border-slate-800">
                  {AVAILABLE_RULES.map((r) => {
                    const checked = newRules.includes(r.id);
                    return (
                      <label key={r.id} className="flex items-center gap-2 cursor-pointer text-slate-300">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewRules([...newRules, r.id]);
                            } else {
                              setNewRules(newRules.filter((id) => id !== r.id));
                            }
                          }}
                          className="rounded border-slate-800 bg-slate-900 text-cyan-600 focus:ring-0"
                        />
                        <span>{r.name}</span>
                      </label>
                    );
                  })}
                  <p className="text-[10px] text-slate-500 pt-1">
                    Leave unselected to receive alerts from all detection rules.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white border border-slate-800 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="px-4 py-2 rounded-xl font-semibold bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-950/50 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {createLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Create Webhook</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ONE-TIME SECRET REVEAL MODAL */}
      {revealedSecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-amber-400">
              <Lock className="w-5 h-5" />
              <h3 className="text-sm font-bold text-white">Save Your Webhook Signing Secret</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              This secret is used to cryptographically verify HMAC-SHA256 signatures for <strong>{revealedSecret.name}</strong>.
              For security, <strong>it will never be displayed in full again</strong>.
            </p>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
              <code className="text-xs text-cyan-300 font-mono break-all select-all">{revealedSecret.secret}</code>
              <button
                onClick={() => handleCopySecret(revealedSecret.secret)}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 transition-colors"
                title="Copy Secret"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setRevealedSecret(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-950/50"
              >
                I have saved this secret
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT WEBHOOK MODAL */}
      {editingWebhook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Edit className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-bold text-white">Edit Webhook Configuration</h3>
              </div>
              <button onClick={() => setEditingWebhook(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditWebhook} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 font-medium mb-1">Webhook Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Destination URL</label>
                <input
                  type="url"
                  required
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono text-[11px]"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Minimum Alert Severity</label>
                <select
                  value={editMinSeverity}
                  onChange={(e) => setEditMinSeverity(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 capitalize"
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s.toUpperCase()} (and higher)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="flex items-center gap-2 cursor-pointer text-slate-300 font-medium">
                  <input
                    type="checkbox"
                    checked={editEnabled}
                    onChange={(e) => setEditEnabled(e.target.checked)}
                    className="rounded border-slate-800 bg-slate-950 text-cyan-600 focus:ring-0"
                  />
                  <span>Active & Delivering Alerts</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingWebhook(null)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white border border-slate-800 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="px-4 py-2 rounded-xl font-semibold bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-950/50 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {editLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ROTATE SECRET CONFIRMATION MODAL */}
      {rotatingWebhook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <RotateCw className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold text-white">Rotate Signing Secret?</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Rotating the signing secret for <strong>{rotatingWebhook.name}</strong> will immediately invalidate the
              existing secret. Ensure you update your receiving application with the new secret immediately.
            </p>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setRotatingWebhook(null)}
                disabled={rotateLoading}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white border border-slate-800 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRotate}
                disabled={rotateLoading}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-slate-950 shadow-md shadow-amber-950/50 flex items-center gap-1.5"
              >
                {rotateLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                <span>Rotate Secret Now</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deletingWebhook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold text-white">Delete Webhook Endpoint?</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to permanently delete <strong>{deletingWebhook.name}</strong> (
              <code>{deletingWebhook.url}</code>)? All delivery logs associated with this webhook will also be removed.
            </p>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setDeletingWebhook(null)}
                disabled={deleteLoading}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white border border-slate-800 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleteLoading}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-950/50 flex items-center gap-1.5"
              >
                {deleteLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                <span>Delete Endpoint</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TEST PING RESULT MODAL */}
      {testResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Send className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-bold text-white">Webhook Test Ping Result</h3>
              </div>
              <button onClick={() => setTestResult(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Endpoint:</span>
                <span className="font-semibold text-white">{testResult.webhookName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Delivery Status:</span>
                <span
                  className={`font-semibold uppercase px-2 py-0.5 rounded text-[10px] ${
                    testResult.delivery.status === 'delivered'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                      : 'bg-rose-950 text-rose-400 border border-rose-800/60'
                  }`}
                >
                  {testResult.delivery.status}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">HTTP Response Code:</span>
                <span className="font-mono text-slate-200">
                  {testResult.delivery.httpStatusCode || 'None / Connection Failure'}
                </span>
              </div>
              {testResult.delivery.errorMessage && (
                <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-200">
                  <span className="font-bold block mb-1">Error Details:</span>
                  <span className="font-mono text-[11px]">{testResult.delivery.errorMessage}</span>
                </div>
              )}
              {testResult.delivery.responseSnippet && (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-300">
                  <span className="font-bold block mb-1 text-slate-400">Response Snippet:</span>
                  <pre className="font-mono text-[11px] whitespace-pre-wrap">
                    {testResult.delivery.responseSnippet}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setTestResult(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELIVERIES AUDIT HISTORY DRAWER */}
      {deliveryDrawerWebhook && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-2xl h-full bg-slate-900 border-l border-slate-800 p-6 flex flex-col justify-between shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white">Delivery Audit Log</h3>
                <p className="text-xs text-slate-400 font-mono">{deliveryDrawerWebhook.name}</p>
              </div>
              <button
                onClick={() => setDeliveryDrawerWebhook(null)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {deliveriesLoading ? (
                <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                  <p className="text-xs">Fetching delivery audit records...</p>
                </div>
              ) : deliveries.length === 0 ? (
                <div className="p-12 text-center text-slate-500 text-xs">
                  No delivery records found for this webhook yet. Trigger an alert or send a test ping to record deliveries.
                </div>
              ) : (
                deliveries.map((del) => (
                  <div
                    key={del.id}
                    className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${
                            del.status === 'delivered'
                              ? 'bg-emerald-950 text-emerald-400 border-emerald-800/60'
                              : del.status === 'blocked_ssrf'
                              ? 'bg-purple-950 text-purple-400 border-purple-800/60'
                              : 'bg-rose-950 text-rose-400 border-rose-800/60'
                          }`}
                        >
                          {del.status}
                        </span>
                        <span className="font-mono text-slate-400">
                          HTTP {del.httpStatusCode || 'None'}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          (Attempt {del.attemptCount})
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500">
                          {new Date(del.createdAt).toLocaleTimeString()}
                        </span>
                        {del.status !== 'delivered' && isOwnerOrAdmin && (
                          <button
                            onClick={() => handleRetryDelivery(del.id)}
                            disabled={retryingDeliveryId === del.id}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-cyan-300 transition-colors flex items-center gap-1 disabled:opacity-50"
                          >
                            {retryingDeliveryId === del.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RotateCw className="w-3 h-3" />
                            )}
                            <span>Retry</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {del.errorMessage && (
                      <div className="p-2 rounded bg-rose-950/30 border border-rose-900/40 text-rose-300 text-[11px] font-mono break-all">
                        {del.errorMessage}
                      </div>
                    )}

                    {del.responseSnippet && (
                      <div className="text-[10px] font-mono text-slate-400 bg-slate-900/80 p-2 rounded border border-slate-800/50 overflow-hidden text-ellipsis">
                        Response: {del.responseSnippet}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setDeliveryDrawerWebhook(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:text-white"
              >
                Close Audit Log
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WebhooksPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center text-xs">
          <Loader2 className="w-6 h-6 animate-spin text-cyan-400 mr-2" />
          Loading Webhooks Console...
        </div>
      }
    >
      <WebhooksContent />
    </Suspense>
  );
}
