'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  RefreshCw,
  Building,
  Building2,
  AlertCircle,
  Clock,
  Sparkles,
  Zap,
  Lock,
  Layers,
  Server,
  Activity,
  LogOut,
  X,
  ExternalLink,
  History,
  Info
} from 'lucide-react';
import {
  apiRequest,
  User,
  WorkspaceSummary,
  OrganizationSummary,
  fetchUserOrganizations,
  fetchBillingPlans,
  fetchSubscriptionDetails,
  createSubscriptionOrder,
  verifyPaymentSignature,
  cancelSubscription,
  PlanDefinition,
  SubscriptionRecord,
  TargetUsage,
  PaymentRecord,
  isUserVerified,
  shouldDisplayVerificationWarning
} from '@/lib/api';

declare global {
  interface Window {
    Razorpay?: any;
  }
}

function BillingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Selected scope
  const [targetType, setTargetType] = useState<'workspace' | 'organization'>('workspace');
  const [targetId, setTargetId] = useState<string>('');

  // User and resources
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);

  // Billing state
  const [plans, setPlans] = useState<PlanDefinition[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(null);
  const [currentPlan, setCurrentPlan] = useState<PlanDefinition | null>(null);
  const [usage, setUsage] = useState<TargetUsage | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [myRole, setMyRole] = useState<string>('viewer');
  const [razorpayConfigured, setRazorpayConfigured] = useState(false);
  const [isTestMode, setIsTestMode] = useState(true);
  const [keyId, setKeyId] = useState('');

  // Page status
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Upgrade / Checkout state
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);
  const [showSimulatedModal, setShowSimulatedModal] = useState<{
    orderId: string;
    planId: string;
    amountPaise: number;
  } | null>(null);

  // Cancellation modal
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);

  // Load Razorpay Checkout Script
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.Razorpay) {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // 1. Initial Load of User and Workspaces/Organizations
  useEffect(() => {
    async function loadAccount() {
      setLoading(true);
      const [meRes, orgsRes, plansRes] = await Promise.all([
        apiRequest<{ user: User; workspaces: WorkspaceSummary[] }>('/api/v1/auth/me'),
        fetchUserOrganizations(),
        fetchBillingPlans()
      ]);

      if (meRes.status === 401) {
        router.push('/login');
        return;
      }

      if (meRes.error || !meRes.data) {
        setError(meRes.error || 'Failed to authenticate user');
        setLoading(false);
        return;
      }

      setUser(meRes.data.user);
      setWorkspaces(meRes.data.workspaces || []);

      const orgList = orgsRes.data?.organizations || [];
      setOrganizations(orgList);

      if (plansRes.data?.plans) {
        setPlans(plansRes.data.plans);
        setRazorpayConfigured(Boolean(plansRes.data.razorpayConfigured));
        setIsTestMode(Boolean(plansRes.data.isTestMode));
        setKeyId(plansRes.data.keyId || '');
      }

      // Determine initial target from URL or defaults
      const queryWs = searchParams.get('workspaceId');
      const queryOrg = searchParams.get('organizationId');

      if (queryOrg && orgList.some((o: OrganizationSummary) => o.id === queryOrg)) {
        setTargetType('organization');
        setTargetId(queryOrg);
      } else if (queryWs && meRes.data.workspaces.some((w: WorkspaceSummary) => w.id === queryWs)) {
        setTargetType('workspace');
        setTargetId(queryWs);
      } else if (meRes.data.workspaces.length > 0) {
        setTargetType('workspace');
        setTargetId(meRes.data.workspaces[0].id);
      } else if (orgList.length > 0) {
        setTargetType('organization');
        setTargetId(orgList[0].id);
      }

      setLoading(false);
    }

    loadAccount();
  }, [router, searchParams]);

  // 2. Fetch Subscription Details whenever Target Changes
  const loadSubscriptionData = useCallback(async (silent = false) => {
    if (!targetId) return;
    if (!silent) setRefreshing(true);

    const subRes = await fetchSubscriptionDetails(targetType, targetId);
    setRefreshing(false);

    if (subRes.error) {
      setError(subRes.error);
      return;
    }

    if (subRes.data) {
      setSubscription(subRes.data.subscription);
      setCurrentPlan(subRes.data.plan);
      setUsage(subRes.data.usage);
      setPayments(subRes.data.payments || []);
      setMyRole(subRes.data.myRole || 'viewer');
      if (subRes.data.razorpayConfigured !== undefined) {
        setRazorpayConfigured(subRes.data.razorpayConfigured);
      }
      if (subRes.data.isTestMode !== undefined) {
        setIsTestMode(subRes.data.isTestMode);
      }
      if (subRes.data.keyId) {
        setKeyId(subRes.data.keyId);
      }
    }
  }, [targetType, targetId]);

  useEffect(() => {
    if (targetId) {
      loadSubscriptionData();
    }
  }, [targetId, loadSubscriptionData]);

  // Initiate Upgrade / Checkout
  const handleSelectPlan = async (plan: PlanDefinition) => {
    if (!targetId || !user) return;
    setActionMessage(null);
    setProcessingPlanId(plan.id);

    try {
      const orderRes = await createSubscriptionOrder(targetType, targetId, plan.id);

      if (orderRes.error || !orderRes.data) {
        setActionMessage({
          type: 'error',
          text: orderRes.error || 'Failed to initiate plan upgrade.'
        });
        setProcessingPlanId(null);
        return;
      }

      // Free plan requires no checkout
      if (plan.id === 'free') {
        setActionMessage({
          type: 'success',
          text: 'Successfully reverted to Free Community tier.'
        });
        await loadSubscriptionData(true);
        setProcessingPlanId(null);
        return;
      }

      const order = orderRes.data.order;
      if (!order) {
        setActionMessage({
          type: 'error',
          text: 'Backend did not return a valid order definition.'
        });
        setProcessingPlanId(null);
        return;
      }

      // If Razorpay SDK is available and live/test keys configured:
      if (typeof window !== 'undefined' && window.Razorpay && razorpayConfigured && !keyId.includes('placeholder')) {
        const options = {
          key: keyId || order.keyId,
          amount: order.amountPaise,
          currency: order.currency,
          name: 'NomaanOS Sentinel',
          description: `Subscription Upgrade to ${plan.name}`,
          order_id: order.id,
          prefill: {
            name: user.fullName || 'Subscriber',
            email: user.email
          },
          theme: {
            color: '#0891b2' // cyan-600
          },
          handler: async (response: any) => {
            // Cryptographic server-side verification
            const verifyRes = await verifyPaymentSignature({
              target_type: targetType,
              target_id: targetId,
              plan_id: plan.id,
              order_id: response.razorpay_order_id || order.id,
              payment_id: response.razorpay_payment_id,
              signature: response.razorpay_signature
            });

            if (verifyRes.error) {
              setActionMessage({
                type: 'error',
                text: `Payment verification failed: ${verifyRes.error}`
              });
            } else {
              setActionMessage({
                type: 'success',
                text: `Successfully upgraded to ${plan.name}! Entitlements activated.`
              });
              await loadSubscriptionData(true);
            }
            setProcessingPlanId(null);
          },
          modal: {
            ondismiss: () => {
              setProcessingPlanId(null);
            }
          }
        };

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', (resp: any) => {
          setActionMessage({
            type: 'error',
            text: `Payment processing failed: ${resp.error?.description || 'Transaction declined'}`
          });
          setProcessingPlanId(null);
        });
        rzp.open();
      } else {
        // Razorpay keys are not configured or simulated test order
        setShowSimulatedModal({
          orderId: order.id,
          planId: plan.id,
          amountPaise: order.amountPaise
        });
        setProcessingPlanId(null);
      }
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: err?.message || 'An unexpected error occurred during checkout.'
      });
      setProcessingPlanId(null);
    }
  };

  // Complete Simulated / Test Mode Checkout
  const handleConfirmSimulatedPayment = async () => {
    if (!showSimulatedModal || !targetId) return;
    const { orderId, planId } = showSimulatedModal;
    setProcessingPlanId(planId);

    const simulatedPaymentId = `pay_sim_${Date.now()}`;
    const simulatedSignature = 'simulated_test_signature_approved';

    const verifyRes = await verifyPaymentSignature({
      target_type: targetType,
      target_id: targetId,
      plan_id: planId,
      order_id: orderId,
      payment_id: simulatedPaymentId,
      signature: simulatedSignature
    });

    setShowSimulatedModal(null);
    setProcessingPlanId(null);

    if (verifyRes.error) {
      setActionMessage({
        type: 'error',
        text: `Test payment verification rejected: ${verifyRes.error}`
      });
    } else {
      setActionMessage({
        type: 'success',
        text: 'Test payment simulated & verified. Plan entitlements activated successfully!'
      });
      await loadSubscriptionData(true);
    }
  };

  // Cancel Subscription
  const handleConfirmCancel = async () => {
    if (!targetId) return;
    setCancelLoading(true);
    const res = await cancelSubscription(targetType, targetId, true);
    setCancelLoading(false);
    setShowCancelModal(false);

    if (res.error) {
      setActionMessage({
        type: 'error',
        text: `Failed to cancel subscription: ${res.error}`
      });
    } else {
      setActionMessage({
        type: 'success',
        text: res.data?.message || 'Subscription marked for cancellation at end of period.'
      });
      await loadSubscriptionData(true);
    }
  };

  const isOwnerOrAdmin = myRole === 'owner' || myRole === 'admin';

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
                <CreditCard className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-white">Subscription & Billing</h1>
                <p className="text-[11px] text-slate-400">Plan quotas, upgrades, and Razorpay integration</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {/* Quick nav to Webhooks */}
            <Link
              href={targetType === 'workspace' && targetId ? `/webhooks?workspaceId=${targetId}` : '/webhooks'}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Webhooks</span>
            </Link>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
              <span className="text-slate-500">User:</span>
              <span className="font-medium text-slate-200">{user?.email}</span>
              {isUserVerified(user) ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/50">
                  <CheckCircle2 className="w-3 h-3" />
                  Verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 font-medium bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/50">
                  Unverified
                </span>
              )}
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
        {/* Resource Scope Switcher (Workspace vs MSP Organization) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-slate-400">Managing Billing For:</span>
            <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800">
              <button
                onClick={() => {
                  setTargetType('workspace');
                  if (workspaces.length > 0) setTargetId(workspaces[0].id);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                  targetType === 'workspace'
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Building className="w-3.5 h-3.5" />
                Workspaces ({workspaces.length})
              </button>
              <button
                onClick={() => {
                  setTargetType('organization');
                  if (organizations.length > 0) setTargetId(organizations[0].id);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                  targetType === 'organization'
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                MSP Organizations ({organizations.length})
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {targetType === 'workspace' ? (
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-xs rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    Workspace: {w.name} ({w.role.toUpperCase()})
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-xs rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    MSP Org: {o.name}
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={() => loadSubscriptionData()}
              disabled={refreshing}
              className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors disabled:opacity-50"
              title="Refresh Billing Details"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} />
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

        {/* Razorpay Gateway Status Notice */}
        {!razorpayConfigured ? (
          <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-800/60 text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Razorpay Gateway Notice:</strong> Live payment keys (<code>RAZORPAY_KEY_ID</code>) are not
                configured in the environment. Simulation mode is available for local testing and entitlement evaluation.
              </span>
            </div>
            <span className="text-[11px] font-mono px-2 py-1 rounded bg-amber-900/60 text-amber-300 shrink-0">
              Dev / Sandbox Mode
            </span>
          </div>
        ) : isTestMode ? (
          <div className="p-3.5 rounded-2xl bg-cyan-950/30 border border-cyan-800/40 text-cyan-200 flex items-center gap-2.5 text-xs">
            <Info className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              <strong>Razorpay Test Mode:</strong> Active key is <code>{keyId}</code>. Test cards and simulated UPI
              can be used without real monetary charges.
            </span>
          </div>
        ) : null}

        {/* Current Subscription & Quota Usage Overview */}
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            <p className="text-xs">Loading billing and subscription details...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Subscription Status Card */}
            <div className="lg:col-span-1 p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs uppercase tracking-wider text-slate-400 font-medium">Current Plan</span>
                  <span
                    className={`text-[10px] font-semibold uppercase px-2.5 py-0.5 rounded-full border ${
                      subscription?.status === 'active'
                        ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60'
                        : subscription?.status === 'trialing'
                        ? 'bg-cyan-950/80 text-cyan-400 border-cyan-800/60'
                        : 'bg-rose-950/80 text-rose-400 border-rose-800/60'
                    }`}
                  >
                    {subscription?.status || 'Active'}
                  </span>
                </div>

                <div className="flex items-baseline gap-2 mb-2">
                  <h2 className="text-2xl font-bold text-white capitalize">{currentPlan?.name || 'Free Community'}</h2>
                  <span className="text-xs text-slate-400">
                    ({currentPlan?.pricing.displayAmount || '₹0/mo'})
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-6">{currentPlan?.description}</p>

                <div className="space-y-2.5 text-xs text-slate-300 border-t border-slate-800/60 pt-4">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Billing Cycle:</span>
                    <span className="capitalize font-medium text-slate-200">
                      {subscription?.billingCycle || 'Monthly'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Current Period Start:</span>
                    <span className="text-slate-200">
                      {subscription?.currentPeriodStart
                        ? new Date(subscription.currentPeriodStart).toLocaleDateString()
                        : 'Active since creation'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Renewal / Period End:</span>
                    <span className="text-slate-200">
                      {subscription?.currentPeriodEnd
                        ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                        : 'No expiration'}
                    </span>
                  </div>
                  {subscription?.cancelAtPeriodEnd && (
                    <div className="p-2.5 rounded-lg bg-amber-950/50 border border-amber-800/60 text-amber-300 text-[11px]">
                      ⚠️ Subscription is scheduled to cancel at the end of the billing period.
                    </div>
                  )}
                </div>
              </div>

              {isOwnerOrAdmin && subscription?.planId !== 'free' && !subscription?.cancelAtPeriodEnd && (
                <div className="pt-6 border-t border-slate-800/60 mt-6">
                  <button
                    onClick={() => setShowCancelModal(true)}
                    className="w-full text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 border border-rose-900/50 py-2 rounded-xl transition-colors"
                  >
                    Cancel Subscription
                  </button>
                </div>
              )}
            </div>

            {/* Quotas & Limits Progress Card */}
            <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 flex flex-col justify-between">
              <div>
                <h3 className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-4">
                  Plan Quotas & Current Consumption
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  {/* Monthly Events Quota */}
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800">
                    <div className="flex items-center gap-2 text-cyan-400 mb-2">
                      <Activity className="w-4 h-4" />
                      <span className="text-xs font-semibold text-slate-300">Monthly Ingestion</span>
                    </div>
                    <div className="text-xl font-bold text-white mb-1">
                      {usage?.monthlyEvents.toLocaleString() ?? 0}
                    </div>
                    <div className="text-[11px] text-slate-400 mb-2">
                      Limit:{' '}
                      {currentPlan?.limits.maxMonthlyEventsPerWorkspace.toLocaleString() ?? '10,000'} / mo
                    </div>
                    {currentPlan && (
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-cyan-500 h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(
                              100,
                              ((usage?.monthlyEvents || 0) / currentPlan.limits.maxMonthlyEventsPerWorkspace) * 100
                            )}%`
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Registered Integrations */}
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800">
                    <div className="flex items-center gap-2 text-indigo-400 mb-2">
                      <Server className="w-4 h-4" />
                      <span className="text-xs font-semibold text-slate-300">Host Agents</span>
                    </div>
                    <div className="text-xl font-bold text-white mb-1">
                      {usage?.integrations ?? 0}
                    </div>
                    <div className="text-[11px] text-slate-400 mb-2">
                      Limit: {currentPlan?.limits.maxIntegrationsPerWorkspace ?? 1} host(s)
                    </div>
                    {currentPlan && (
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-indigo-500 h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(
                              100,
                              ((usage?.integrations || 0) / currentPlan.limits.maxIntegrationsPerWorkspace) * 100
                            )}%`
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Client Workspaces (MSP Org) */}
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800">
                    <div className="flex items-center gap-2 text-purple-400 mb-2">
                      <Layers className="w-4 h-4" />
                      <span className="text-xs font-semibold text-slate-300">Client Workspaces</span>
                    </div>
                    <div className="text-xl font-bold text-white mb-1">
                      {targetType === 'organization' ? usage?.clientWorkspaces ?? 0 : '1 (Self)'}
                    </div>
                    <div className="text-[11px] text-slate-400 mb-2">
                      Limit: {currentPlan?.limits.maxClientWorkspaces ?? 1} client(s)
                    </div>
                    {currentPlan && targetType === 'organization' && (
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-purple-500 h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(
                              100,
                              ((usage?.clientWorkspaces || 0) / currentPlan.limits.maxClientWorkspaces) * 100
                            )}%`
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Feature Gating Matrix */}
                <h4 className="text-[11px] uppercase tracking-wider text-slate-400 font-medium mb-3">
                  Plan Entitlements
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div
                    className={`p-2.5 rounded-xl border flex items-center gap-2 ${
                      currentPlan?.features.canUseAiInvestigations
                        ? 'bg-cyan-950/40 border-cyan-800/60 text-cyan-300'
                        : 'bg-slate-950/40 border-slate-800 text-slate-500'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI Assistant</span>
                  </div>

                  <div
                    className={`p-2.5 rounded-xl border flex items-center gap-2 ${
                      currentPlan?.features.canUseOutboundWebhooks
                        ? 'bg-cyan-950/40 border-cyan-800/60 text-cyan-300'
                        : 'bg-slate-950/40 border-slate-800 text-slate-500'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Alert Webhooks</span>
                  </div>

                  <div
                    className={`p-2.5 rounded-xl border flex items-center gap-2 ${
                      currentPlan?.features.canUseMspConsole
                        ? 'bg-cyan-950/40 border-cyan-800/60 text-cyan-300'
                        : 'bg-slate-950/40 border-slate-800 text-slate-500'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span>MSP Console</span>
                  </div>

                  <div
                    className={`p-2.5 rounded-xl border flex items-center gap-2 ${
                      currentPlan?.features.canExportReports
                        ? 'bg-cyan-950/40 border-cyan-800/60 text-cyan-300'
                        : 'bg-slate-950/40 border-slate-800 text-slate-500'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Audit Export</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800/60 mt-4 text-[11px] text-slate-400 flex items-center justify-between">
                <span>Data Retention: {currentPlan?.limits.retentionDays || 30} days</span>
                <span>SLA: {currentPlan?.features.slaTier?.toUpperCase() || 'COMMUNITY'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Available Plans Comparison & Upgrade Selection */}
        <section className="space-y-6 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Upgrade or Change Plan</h2>
              <p className="text-xs text-slate-400">
                Scale your SOC monitoring capacity, multi-client reach, and automated investigations
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {plans.map((p) => {
              const isCurrent = subscription?.planId === p.id;
              const isProcessing = processingPlanId === p.id;

              return (
                <div
                  key={p.id}
                  className={`rounded-2xl p-6 flex flex-col justify-between transition-all ${
                    isCurrent
                      ? 'bg-cyan-950/40 border-2 border-cyan-500/80 shadow-lg shadow-cyan-950/50'
                      : 'bg-slate-900/60 border border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-base font-bold text-white">{p.name}</h3>
                      {isCurrent && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500 text-slate-950">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mb-4">{p.description}</p>

                    <div className="mb-6">
                      <span className="text-2xl font-extrabold text-white">{p.pricing.displayAmount}</span>
                      <span className="text-xs text-slate-500"> / month</span>
                    </div>

                    <div className="space-y-2.5 text-xs text-slate-300 border-t border-slate-800/60 pt-4 mb-6">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span>Up to {p.limits.maxClientWorkspaces} Client Workspace(s)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span>Up to {p.limits.maxIntegrationsPerWorkspace} Host Integration(s)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span>{p.limits.maxMonthlyEventsPerWorkspace.toLocaleString()} Monthly Events</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.features.canUseAiInvestigations ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        ) : (
                          <X className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                        )}
                        <span className={p.features.canUseAiInvestigations ? 'text-slate-200' : 'text-slate-500'}>
                          AI Investigation Assistant
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.features.canUseOutboundWebhooks ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        ) : (
                          <X className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                        )}
                        <span className={p.features.canUseOutboundWebhooks ? 'text-slate-200' : 'text-slate-500'}>
                          Outbound Alert Webhooks
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.features.canUseMspConsole ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        ) : (
                          <X className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                        )}
                        <span className={p.features.canUseMspConsole ? 'text-slate-200' : 'text-slate-500'}>
                          MSP Centralized Console
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    {isCurrent ? (
                      <button
                        disabled
                        className="w-full py-2.5 rounded-xl text-xs font-semibold bg-slate-800 text-slate-400 cursor-not-allowed"
                      >
                        Active Plan
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSelectPlan(p)}
                        disabled={isProcessing || !isOwnerOrAdmin}
                        className="w-full py-2.5 rounded-xl text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors flex items-center justify-center gap-2 shadow-md shadow-cyan-950/50 disabled:opacity-50"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Processing...</span>
                          </>
                        ) : (
                          <span>{p.id === 'free' ? 'Downgrade to Free' : `Upgrade to ${p.name}`}</span>
                        )}
                      </button>
                    )}
                    {!isOwnerOrAdmin && (
                      <p className="text-[10px] text-slate-500 text-center mt-2">
                        Administrator permissions required
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Payment History Section */}
        <section className="space-y-4 pt-6 border-t border-slate-800/80">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Payment & Billing History</h3>
          </div>

          {payments.length === 0 ? (
            <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800/80 text-center text-xs text-slate-500">
              No payment transactions recorded for this resource yet.
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800/80 overflow-hidden bg-slate-900/60">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Payment ID</th>
                    <th className="px-4 py-3">Order ID</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {payments.map((pmt) => (
                    <tr key={pmt.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3 text-slate-400">
                        {new Date(pmt.createdAt).toLocaleDateString()}{' '}
                        {new Date(pmt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-300">
                        {pmt.providerPaymentId || 'N/A'}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                        {pmt.providerOrderId || 'N/A'}
                      </td>
                      <td className="px-4 py-3 font-medium text-white">
                        ₹{(pmt.amountPaise / 100).toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${
                            pmt.status === 'captured'
                              ? 'bg-emerald-950 text-emerald-400 border-emerald-800/60'
                              : 'bg-rose-950 text-rose-400 border-rose-800/60'
                          }`}
                        >
                          {pmt.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Simulated / Test Payment Modal (When Razorpay live keys are not configured) */}
      {showSimulatedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-bold text-white">Razorpay Sandbox Simulation</h3>
              </div>
              <button
                onClick={() => setShowSimulatedModal(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-800/60 text-cyan-200 text-xs">
              Because production Razorpay API keys are not detected in the environment, you can test this transaction
              using the built-in deterministic verification engine.
            </div>

            <div className="space-y-2 text-xs text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Target Plan:</span>
                <span className="font-semibold text-white uppercase">{showSimulatedModal.planId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Simulated Order:</span>
                <span className="font-mono text-[11px] text-slate-200">{showSimulatedModal.orderId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Amount:</span>
                <span className="font-semibold text-white">
                  ₹{(showSimulatedModal.amountPaise / 100).toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowSimulatedModal(null)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white border border-slate-800 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSimulatedPayment}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-950/50"
              >
                Simulate Successful Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancellation Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold text-white">Cancel Subscription?</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Your subscription will remain active until the end of the current billing cycle. At that point, the
              resource will transition to the Free Community plan limits (1 host agent, 10,000 events/mo).
            </p>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowCancelModal(false)}
                disabled={cancelLoading}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white border border-slate-800 hover:bg-slate-800"
              >
                Keep Subscription
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={cancelLoading}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-950/50 flex items-center gap-1.5"
              >
                {cancelLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                <span>Confirm Cancellation</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center text-xs">
          <Loader2 className="w-6 h-6 animate-spin text-cyan-400 mr-2" />
          Loading Billing Console...
        </div>
      }
    >
      <BillingContent />
    </Suspense>
  );
}

