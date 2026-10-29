'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ShieldCheck, 
  Building, 
  Plus, 
  LogOut, 
  AlertTriangle, 
  CheckCircle2, 
  ArrowRight, 
  Loader2,
  Users,
  ShieldAlert,
  Building2,
  Layers,
  ArrowUpRight,
  Briefcase,
  CreditCard,
  Zap
} from 'lucide-react';
import { 
  apiRequest, 
  User, 
  WorkspaceSummary, 
  OrganizationSummary,
  fetchUserOrganizations,
  createOrganization,
  isUserVerified, 
  shouldDisplayVerificationWarning 
} from '@/lib/api';

interface ExtendedWorkspaceSummary extends WorkspaceSummary {
  organization_name?: string | null;
}

export default function WorkspacesPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<ExtendedWorkspaceSummary[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tab navigation
  const [viewTab, setViewTab] = useState<'workspaces' | 'organizations'>('workspaces');

  // New workspace creation state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // New MSP Organization creation state
  const [showCreateOrgModal, setShowCreateOrgModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [createOrgLoading, setCreateOrgLoading] = useState(false);
  const [createOrgError, setCreateOrgError] = useState<string | null>(null);

  // Filter workspaces by organization
  const [orgFilter, setOrgFilter] = useState<string>('all');

  // Verification resend state
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);

  const fetchUserData = async (silent = false) => {
    if (!silent) setLoading(true);
    const [meRes, orgsRes] = await Promise.all([
      apiRequest<{ user: User; workspaces: ExtendedWorkspaceSummary[] }>('/api/v1/auth/me'),
      fetchUserOrganizations()
    ]);
    if (!silent) setLoading(false);

    if (meRes.status === 401) {
      router.push('/login');
      return;
    }

    if (meRes.error || !meRes.data) {
      setError(meRes.error || 'Failed to fetch account profile');
      return;
    }

    setUser(meRes.data.user);
    setWorkspaces(meRes.data.workspaces);

    if (orgsRes.data?.organizations) {
      setOrganizations(orgsRes.data.organizations);
    }
  };

  useEffect(() => {
    fetchUserData();
  }, []);

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateLoading(true);

    const res = await apiRequest<{ workspace: WorkspaceSummary }>('/api/v1/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name: newWorkspaceName }),
    });

    setCreateLoading(false);

    if (res.error) {
      setCreateError(res.error);
      return;
    }

    setShowCreateModal(false);
    setNewWorkspaceName('');
    await fetchUserData(true);
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateOrgError(null);
    setCreateOrgLoading(true);

    const res = await createOrganization({
      name: newOrgName,
      slug: newOrgSlug || undefined,
    });

    setCreateOrgLoading(false);

    if (res.error) {
      setCreateOrgError(res.error);
      return;
    }

    setShowCreateOrgModal(false);
    setNewOrgName('');
    setNewOrgSlug('');
    await fetchUserData(true);
    setViewTab('organizations');
  };

  const handleResendVerification = async () => {
    setResendLoading(true);
    setResendStatus(null);
    const res = await apiRequest<{ message?: string; alreadyVerified?: boolean; isVerified?: boolean }>(
      '/api/v1/auth/resend-verification',
      { method: 'POST' }
    );
    setResendLoading(false);

    if (res.error) {
      const isAlreadyVerified = 
        res.error.toLowerCase().includes('already verified') || 
        Boolean((res as any).data?.alreadyVerified) ||
        Boolean((res as any).data?.isVerified);

      if (isAlreadyVerified) {
        await fetchUserData(true);
        setResendStatus('Your email is already verified.');
      } else {
        setResendStatus(`Failed: ${res.error}`);
      }
    } else {
      setResendStatus('Verification link dispatched to your inbox.');
    }
  };

  const handleLogout = async () => {
    await apiRequest('/api/v1/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
        <div className="flex items-center gap-3 text-xs">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
          Loading security console...
        </div>
      </div>
    );
  }

  const filteredWorkspaces = workspaces.filter(ws => {
    if (orgFilter === 'all') return true;
    if (orgFilter === 'standalone') return !ws.organization_id && !ws.organizationId;
    return (ws.organization_id === orgFilter) || (ws.organizationId === orgFilter);
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Navigation & Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-slate-800 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-950/60 border border-cyan-800/50 text-cyan-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">NomaanOS Sentinel</h1>
              <p className="text-xs text-slate-400">Security Operations & Multi-Tenant Directory</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {/* Direct Navigation Links for Billing & Webhooks */}
            <Link
              href="/billing"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors"
              title="Subscriptions, plan quotas, and payments"
            >
              <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
              <span>Billing</span>
            </Link>

            <Link
              href="/webhooks"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors"
              title="Outbound alert webhooks & integrations"
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
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </header>

        {/* Verification Alert Banner if unverified */}
        {shouldDisplayVerificationWarning(user) && (
          <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Your account email is unverified. Certain administrative actions (creating organizations, managing members) require email confirmation.
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {resendStatus && <span className="text-[11px] text-amber-300">{resendStatus}</span>}
              <button
                onClick={handleResendVerification}
                disabled={resendLoading}
                className="px-3 py-1 rounded-lg bg-amber-900/60 hover:bg-amber-800/80 border border-amber-700/60 text-amber-100 font-medium transition-colors disabled:opacity-50"
              >
                {resendLoading ? 'Sending...' : 'Resend Verification'}
              </button>
            </div>
          </div>
        )}

        {/* Tab switch between MSP Organizations and Workspaces */}
        <div className="flex items-center justify-between border-b border-slate-800/70 pb-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <button
              onClick={() => setViewTab('workspaces')}
              className={`px-3.5 py-1.5 rounded-xl transition-colors flex items-center gap-2 ${
                viewTab === 'workspaces'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60 font-semibold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Building className="w-3.5 h-3.5" />
              Workspaces & Clients ({workspaces.length})
            </button>
            <button
              onClick={() => setViewTab('organizations')}
              className={`px-3.5 py-1.5 rounded-xl transition-colors flex items-center gap-2 ${
                viewTab === 'organizations'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60 font-semibold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              MSP Organizations ({organizations.length})
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            {viewTab === 'workspaces' ? (
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium shadow-md shadow-cyan-950/40 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New Workspace
              </button>
            ) : (
              <button
                onClick={() => setShowCreateOrgModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium shadow-md shadow-cyan-950/40 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New MSP Organization
              </button>
            )}
          </div>
        </div>

        {/* =========================================================================
            VIEW 1: WORKSPACES & CLIENTS
        ========================================================================= */}
        {viewTab === 'workspaces' && (
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Building className="w-4 h-4 text-cyan-400" />
                  Active Workspaces & Client Tenants
                </h2>
                <p className="text-xs text-slate-400">Select an environment to investigate telemetry and manage detections</p>
              </div>

              {organizations.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500 text-[11px]">Filter:</span>
                  <select
                    value={orgFilter}
                    onChange={(e) => setOrgFilter(e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                  >
                    <option value="all">All Environments ({workspaces.length})</option>
                    <option value="standalone">Standalone Workspaces</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        MSP: {org.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {filteredWorkspaces.length === 0 ? (
              <div className="p-8 text-center rounded-2xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
                No workspaces found matching the selected filter.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredWorkspaces.map((ws) => (
                  <div
                    key={ws.id}
                    className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-all space-y-4 flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-slate-500 truncate max-w-[160px]">
                          {ws.slug}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider ${
                          ws.role === 'owner' ? 'bg-purple-950 text-purple-300 border border-purple-800/50' :
                          ws.role === 'admin' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/50' :
                          ws.role === 'analyst' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50' :
                          'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}>
                          {ws.role}
                        </span>
                      </div>
                      
                      <div className="space-y-1">
                        <h3 className="font-semibold text-white text-sm">{ws.name}</h3>
                        {ws.organization_name ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-850">
                            Client of {ws.organization_name}
                          </span>
                        ) : ws.organization_id ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-850">
                            MSP Client Workspace
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/60">
                            Standalone Workspace
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs">
                      <span className="text-slate-500 flex items-center gap-1.5 text-[11px]">
                        <Users className="w-3.5 h-3.5" />
                        {ws.member_count ?? 1} members
                      </span>
                      <Link
                        href={`/workspaces/${ws.id}`}
                        className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-medium transition-colors"
                      >
                        Open Console
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* =========================================================================
            VIEW 2: MSP ORGANIZATIONS
        ========================================================================= */}
        {viewTab === 'organizations' && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-cyan-400" />
                  MSP Organizations
                </h2>
                <p className="text-xs text-slate-400">
                  Centralized operational platforms for managing multiple client business accounts
                </p>
              </div>
              <button
                onClick={() => setShowCreateOrgModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium shadow-md transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New MSP Organization
              </button>
            </div>

            {organizations.length === 0 ? (
              <div className="p-10 text-center rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
                <Building2 className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-300 font-medium">No MSP Organizations found.</p>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  Create an MSP organization to manage multiple business clients from a single unified console with cross-client alerts, fleet health, and accurate usage metrics.
                </p>
                <button
                  onClick={() => setShowCreateOrgModal(true)}
                  className="px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
                >
                  Create MSP Organization
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {organizations.map((org) => (
                  <div
                    key={org.id}
                    className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-all space-y-4 flex flex-col justify-between"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-slate-500 truncate max-w-[150px]">
                          {org.slug}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider ${
                          org.role === 'owner' ? 'bg-purple-950 text-purple-300 border border-purple-800/50' :
                          org.role === 'admin' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/50' :
                          'bg-emerald-950 text-emerald-300 border border-emerald-800/50'
                        }`}>
                          MSP {org.role}
                        </span>
                      </div>

                      <div>
                        <h3 className="font-semibold text-white text-base">{org.name}</h3>
                        <p className="text-[11px] text-slate-500">MSP Platform ID: {org.id.slice(0, 8)}...</p>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/60 text-xs">
                        <div>
                          <span className="text-[10px] text-slate-500 block">Client Workspaces</span>
                          <span className="font-semibold text-cyan-300 text-sm">
                            {org.clientCount ?? 0} Clients
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block">MSP Staff</span>
                          <span className="font-semibold text-slate-200 text-sm">
                            {org.memberCount ?? 1} Staff
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-800/60 flex items-center justify-end">
                      <Link
                        href={`/organizations/${org.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors shadow-sm"
                      >
                        Launch MSP Console
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Modal: Create Standalone Workspace */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Create New Workspace</h3>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-slate-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              </div>

              {createError && (
                <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-xs">
                  {createError}
                </div>
              )}

              <form onSubmit={handleCreateWorkspace} className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">Workspace Name</label>
                  <input
                    type="text"
                    required
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    placeholder="e.g. Acme Security Operations"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createLoading}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    {createLoading ? 'Creating...' : 'Create Workspace'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Create MSP Organization */}
        {showCreateOrgModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Create New MSP Organization</h3>
                <button
                  onClick={() => setShowCreateOrgModal(false)}
                  className="text-slate-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              </div>

              {createOrgError && (
                <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-xs">
                  {createOrgError}
                </div>
              )}

              <form onSubmit={handleCreateOrg} className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">MSP Organization Name</label>
                  <input
                    type="text"
                    required
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    placeholder="e.g. Apex Managed Security Provider"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">Platform Slug (Optional)</label>
                  <input
                    type="text"
                    value={newOrgSlug}
                    onChange={(e) => setNewOrgSlug(e.target.value)}
                    placeholder="e.g. apex-msp"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                  <p className="text-[10px] text-slate-500">
                    If empty, a unique URL slug will be auto-generated.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateOrgModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createOrgLoading}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    {createOrgLoading ? 'Creating...' : 'Create MSP Platform'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
