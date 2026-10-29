'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Building2,
  Users,
  ShieldAlert,
  Server,
  Briefcase,
  Activity,
  Plus,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Download,
  Trash2,
  Shield,
  Layers,
  ArrowUpRight,
  TrendingUp,
  Clock,
  Sparkles,
  Loader2,
  UserCheck,
  UserX,
  ExternalLink,
  CreditCard
} from 'lucide-react';
import {
  apiRequest,
  OrganizationSummary,
  OrganizationMember,
  MspClientSummary,
  MspAlertSummary,
  MspAlertsResponse,
  MspFleetHost,
  MspFleetSummary,
  MspFleetHealthResponse,
  normalizeFleetResponse,
  MspCaseSummary,
  MspCasesResponse,
  MspClientUsage,
  MspUsageTotals,
  MspUsageResponse,
  normalizeUsageResponse,
  MspConsolidatedReport,
  normalizeConsolidatedReport,
  fetchOrganizationDetails,
  fetchOrganizationMembers,
  addOrganizationMember,
  updateOrganizationMember,
  removeOrganizationMember,
  fetchOrganizationClients,
  createOrganizationClient,
  fetchOrganizationAlerts,
  fetchOrganizationFleet,
  fetchOrganizationCases,
  fetchOrganizationUsage,
  fetchConsolidatedReport
} from '@/lib/api';

export default function OrganizationConsolePage() {
  const params = useParams();
  const router = useRouter();
  const organizationId = params.organizationId as string;

  // Active navigation tab
  const [activeTab, setActiveTab] = useState<
    'overview' | 'alerts' | 'fleet' | 'cases' | 'clients' | 'usage' | 'members'
  >('overview');

  // Core Organization State
  const [org, setOrg] = useState<OrganizationSummary | null>(null);
  const [myRole, setMyRole] = useState<string>('viewer');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Clients State
  const [clients, setClients] = useState<MspClientSummary[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientSlug, setNewClientSlug] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);
  const [createClientError, setCreateClientError] = useState<string | null>(null);

  // Consolidated Alerts State
  const [alerts, setAlerts] = useState<MspAlertSummary[]>([]);
  const [alertsSummary, setAlertsSummary] = useState<MspAlertsResponse['summary'] | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertClientFilter, setAlertClientFilter] = useState('all');
  const [alertSeverityFilter, setAlertSeverityFilter] = useState('all');
  const [alertStatusFilter, setAlertStatusFilter] = useState('all');

  // Fleet Health State
  const [fleetHosts, setFleetHosts] = useState<MspFleetHost[]>([]);
  const [fleetSummary, setFleetSummary] = useState<MspFleetSummary | null>(null);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [fleetClientFilter, setFleetClientFilter] = useState('all');
  const [fleetHealthFilter, setFleetHealthFilter] = useState('all');

  // Consolidated Cases State
  const [cases, setCases] = useState<MspCaseSummary[]>([]);
  const [casesSummary, setCasesSummary] = useState<MspCasesResponse['summary'] | null>(null);
  const [casesLoading, setCasesLoading] = useState(false);
  const [casesError, setCasesError] = useState<string | null>(null);
  const [caseClientFilter, setCaseClientFilter] = useState('all');
  const [caseStatusFilter, setCaseStatusFilter] = useState('all');
  const [casePriorityFilter, setCasePriorityFilter] = useState('all');

  // Usage State
  const [usageData, setUsageData] = useState<MspClientUsage[]>([]);
  const [usageTotals, setUsageTotals] = useState<MspUsageTotals | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [report, setReport] = useState<MspConsolidatedReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Members / RBAC State
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'admin' | 'analyst' | 'viewer'>('analyst');
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  // 1. Fetch Organization Details
  const loadOrgDetails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOrganizationDetails(organizationId);
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (res.status === 403) {
        setError('You do not have permission to access this MSP organization.');
        return;
      }
      if (res.error || !res.data) {
        setError(res.error || 'Failed to load MSP organization details.');
        return;
      }
      setOrg(res.data.organization);
      setMyRole(res.data.myRole);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error loading organization details.');
    } finally {
      setLoading(false);
    }
  }, [organizationId, router]);

  // 2. Fetch Clients
  const loadClients = useCallback(async () => {
    setClientsLoading(true);
    setClientsError(null);
    try {
      const res = await fetchOrganizationClients(organizationId);
      if (res.error) {
        setClientsError(res.error);
        setClients([]);
      } else if (res.data) {
        setClients(Array.isArray(res.data.clients) ? res.data.clients : []);
      }
    } catch (err) {
      setClientsError(err instanceof Error ? err.message : 'Failed to load clients.');
      setClients([]);
    } finally {
      setClientsLoading(false);
    }
  }, [organizationId]);

  // 3. Fetch Consolidated Alerts
  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsError(null);
    try {
      const res = await fetchOrganizationAlerts(organizationId, {
        clientId: alertClientFilter !== 'all' ? alertClientFilter : undefined,
        severity: alertSeverityFilter !== 'all' ? alertSeverityFilter : undefined,
        status: alertStatusFilter !== 'all' ? alertStatusFilter : undefined,
        limit: 100,
      });
      if (res.error) {
        setAlertsError(res.error);
        setAlerts([]);
        setAlertsSummary(null);
      } else if (res.data) {
        setAlerts(Array.isArray(res.data.alerts) ? res.data.alerts : []);
        setAlertsSummary(res.data.summary || null);
      }
    } catch (err) {
      setAlertsError(err instanceof Error ? err.message : 'Failed to load alerts.');
      setAlerts([]);
      setAlertsSummary(null);
    } finally {
      setAlertsLoading(false);
    }
  }, [organizationId, alertClientFilter, alertSeverityFilter, alertStatusFilter]);

  // 4. Fetch Fleet Health
  const loadFleet = useCallback(async () => {
    setFleetLoading(true);
    setFleetError(null);
    try {
      const res = await fetchOrganizationFleet(organizationId);
      if (res.error) {
        setFleetError(res.error);
        setFleetHosts([]);
        setFleetSummary(null);
      } else if (res.data) {
        const { hosts, summary } = normalizeFleetResponse(res.data);
        setFleetHosts(hosts);
        setFleetSummary(summary);
      } else {
        setFleetHosts([]);
        setFleetSummary(null);
      }
    } catch (err) {
      setFleetError(err instanceof Error ? err.message : 'Failed to query fleet health.');
      setFleetHosts([]);
      setFleetSummary(null);
    } finally {
      setFleetLoading(false);
    }
  }, [organizationId]);

  // 5. Fetch Consolidated Cases
  const loadCases = useCallback(async () => {
    setCasesLoading(true);
    setCasesError(null);
    try {
      const res = await fetchOrganizationCases(organizationId, {
        clientId: caseClientFilter !== 'all' ? caseClientFilter : undefined,
        status: caseStatusFilter !== 'all' ? caseStatusFilter : undefined,
        priority: casePriorityFilter !== 'all' ? casePriorityFilter : undefined,
      });
      if (res.error) {
        setCasesError(res.error);
        setCases([]);
        setCasesSummary(null);
      } else if (res.data) {
        setCases(Array.isArray(res.data.cases) ? res.data.cases : []);
        setCasesSummary(res.data.summary || null);
      }
    } catch (err) {
      setCasesError(err instanceof Error ? err.message : 'Failed to load cases.');
      setCases([]);
      setCasesSummary(null);
    } finally {
      setCasesLoading(false);
    }
  }, [organizationId, caseClientFilter, caseStatusFilter, casePriorityFilter]);

  // 6. Fetch Usage Metrics
  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    setUsageError(null);
    try {
      const res = await fetchOrganizationUsage(organizationId);
      if (res.error) {
        setUsageError(res.error);
        setUsageData([]);
        setUsageTotals(null);
      } else if (res.data) {
        const { totals, clients: normalizedClients } = normalizeUsageResponse(res.data);
        setUsageData(normalizedClients);
        setUsageTotals(totals);
      } else {
        setUsageData([]);
        setUsageTotals(null);
      }
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : 'Failed to load usage metrics.');
      setUsageData([]);
      setUsageTotals(null);
    } finally {
      setUsageLoading(false);
    }
  }, [organizationId]);

  // 7. Fetch Consolidated Report
  const loadReport = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      const res = await fetchConsolidatedReport(organizationId);
      if (res.error) {
        setReportError(res.error);
        setReport(null);
      } else if (res.data) {
        const normalized = normalizeConsolidatedReport(res.data);
        if (normalized) {
          setReport(normalized);
        } else {
          setReportError('Unexpected report data structure received from server.');
          setReport(null);
        }
      } else {
        setReport(null);
      }
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Failed to generate executive report.');
      setReport(null);
    } finally {
      setReportLoading(false);
    }
  }, [organizationId]);

  // 8. Fetch Members
  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    setMembersError(null);
    try {
      const res = await fetchOrganizationMembers(organizationId);
      if (res.error) {
        setMembersError(res.error);
        setMembers([]);
      } else if (res.data) {
        setMembers(Array.isArray(res.data.members) ? res.data.members : []);
      }
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Failed to load staff members.');
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, [organizationId]);

  // Initial Load
  useEffect(() => {
    loadOrgDetails();
    loadClients();
  }, [loadOrgDetails, loadClients]);

  // Tab-specific loading
  useEffect(() => {
    if (activeTab === 'alerts') loadAlerts();
    if (activeTab === 'fleet') loadFleet();
    if (activeTab === 'cases') loadCases();
    if (activeTab === 'usage') {
      loadUsage();
      loadReport();
    }
    if (activeTab === 'members') loadMembers();
  }, [activeTab, loadAlerts, loadFleet, loadCases, loadUsage, loadReport, loadMembers]);

  // Handle Client Creation
  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateClientError(null);
    setCreatingClient(true);

    const res = await createOrganizationClient(organizationId, {
      name: newClientName,
      slug: newClientSlug || undefined,
    });
    setCreatingClient(false);

    if (res.error) {
      setCreateClientError(res.error);
      return;
    }

    setShowAddClientModal(false);
    setNewClientName('');
    setNewClientSlug('');
    setActionMessage('Client workspace created and linked successfully.');
    loadClients();
    loadOrgDetails();
  };

  // Handle Member Add
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setMemberError(null);
    setAddingMember(true);

    const res = await addOrganizationMember(organizationId, {
      email: newMemberEmail,
      role: newMemberRole,
    });
    setAddingMember(false);

    if (res.error) {
      setMemberError(res.error);
      return;
    }

    setShowAddMemberModal(false);
    setNewMemberEmail('');
    setActionMessage('MSP staff member added successfully.');
    loadMembers();
    loadOrgDetails();
  };

  // Handle Member Role Update
  const handleUpdateRole = async (userId: string, newRole: 'owner' | 'admin' | 'analyst' | 'viewer') => {
    const res = await updateOrganizationMember(organizationId, userId, newRole);
    if (res.error) {
      setActionMessage(`Failed to update role: ${res.error}`);
    } else {
      setActionMessage('Staff role updated.');
      loadMembers();
    }
  };

  // Handle Member Removal
  const handleRemoveMember = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this staff member from the MSP organization?')) return;
    const res = await removeOrganizationMember(organizationId, userId);
    if (res.error) {
      setActionMessage(`Failed to remove member: ${res.error}`);
    } else {
      setActionMessage('Staff member removed.');
      loadMembers();
      loadOrgDetails();
    }
  };

  // Quick helper to download executive report
  const downloadReportJson = () => {
    if (!report) return;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(report, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${org?.slug || 'msp'}-security-report.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
        <div className="flex items-center gap-3 text-xs">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
          Loading MSP Organization Console...
        </div>
      </div>
    );
  }

  if (error || !org) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-6">
        <div className="max-w-md w-full p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-white">Access Denied or Not Found</h2>
          <p className="text-xs text-slate-400">{error || 'MSP Organization could not be loaded.'}</p>
          <Link
            href="/workspaces"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Directory
          </Link>
        </div>
      </div>
    );
  }

  // Calculate overview totals from clients
  const totalServers = clients.reduce((acc, c) => acc + (Number(c.serverCount) || 0), 0);
  const totalActiveAlerts = clients.reduce((acc, c) => acc + (Number(c.activeAlertsCount) || 0), 0);
  const totalEvents = clients.reduce((acc, c) => acc + (Number(c.eventsCount) || 0), 0);
  const totalCases = clients.reduce((acc, c) => acc + (Number(c.casesCount) || 0), 0);

  // Safely computed filtered fleet hosts
  const displayedFleetHosts = (Array.isArray(fleetHosts) ? fleetHosts : []).filter((h) => {
    if (fleetClientFilter !== 'all' && h.clientId !== fleetClientFilter) return false;
    if (fleetHealthFilter !== 'all' && h.healthStatus !== fleetHealthFilter) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Top Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-slate-800/80 gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/workspaces"
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-colors"
              title="Return to Directory"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="p-2.5 rounded-xl bg-cyan-950/60 border border-cyan-800/50 text-cyan-400">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold text-white">{org.name}</h1>
                <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">
                  {org.slug}
                </span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-cyan-950 text-cyan-300 border border-cyan-800/60">
                  MSP {myRole}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Centralized MSP Security Console & Multi-Client Operations
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 text-xs">
            {actionMessage && (
              <span className="px-3 py-1 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 animate-fade-in text-[11px]">
                {actionMessage}
              </span>
            )}
            {(myRole === 'owner' || myRole === 'admin') && (
              <button
                onClick={() => setShowAddClientModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors shadow-md shadow-cyan-950/40"
              >
                <Plus className="w-3.5 h-3.5" />
                Onboard Client
              </button>
            )}
            <button
              onClick={() => {
                loadOrgDetails();
                loadClients();
                if (activeTab === 'alerts') loadAlerts();
                if (activeTab === 'fleet') loadFleet();
                if (activeTab === 'cases') loadCases();
                if (activeTab === 'usage') loadUsage();
                if (activeTab === 'members') loadMembers();
              }}
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 transition-colors"
              title="Refresh Data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1.5 border-b border-slate-800/60 pb-2 overflow-x-auto text-xs font-medium">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-colors ${
              activeTab === 'overview'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Overview
          </button>
          <button
            onClick={() => setActiveTab('clients')}
            className={`px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-colors ${
              activeTab === 'clients'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Clients ({clients.length})
          </button>
          <button
            onClick={() => setActiveTab('alerts')}
            className={`px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-colors ${
              activeTab === 'alerts'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Consolidated Alerts
            {totalActiveAlerts > 0 && (
              <span className="px-1.5 py-0.2 bg-rose-500/20 text-rose-300 text-[10px] rounded-full border border-rose-500/40 font-mono">
                {totalActiveAlerts}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('fleet')}
            className={`px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-colors ${
              activeTab === 'fleet'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            Fleet Health ({totalServers})
          </button>
          <button
            onClick={() => setActiveTab('cases')}
            className={`px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-colors ${
              activeTab === 'cases'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            Cases ({totalCases})
          </button>
          <button
            onClick={() => setActiveTab('usage')}
            className={`px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-colors ${
              activeTab === 'usage'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Usage & Reports
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-colors ${
              activeTab === 'members'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Staff & RBAC
          </button>
          <Link
            href={`/billing?organizationId=${organizationId}`}
            className="px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-colors text-slate-400 hover:text-slate-200 hover:bg-slate-900"
          >
            <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
            Billing & Plans
          </Link>
        </div>

        {/* =========================================================================
            TAB 1: OVERVIEW DASHBOARD
        ========================================================================= */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1">
                <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  Client Workspaces
                </span>
                <p className="text-2xl font-bold text-white">{clients.length}</p>
                <p className="text-[10px] text-slate-500">Isolated tenant environments</p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1">
                <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-indigo-400" />
                  Monitored Servers
                </span>
                <p className="text-2xl font-bold text-white">{totalServers}</p>
                <p className="text-[10px] text-slate-500">Connected Linux agents</p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1">
                <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                  Active Threats
                </span>
                <p className={`text-2xl font-bold ${totalActiveAlerts > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {totalActiveAlerts}
                </p>
                <p className="text-[10px] text-slate-500">Unresolved security alerts</p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1">
                <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-amber-400" />
                  Security Cases
                </span>
                <p className="text-2xl font-bold text-white">{totalCases}</p>
                <p className="text-[10px] text-slate-500">Investigations opened</p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1">
                <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-teal-400" />
                  Telemetry Events
                </span>
                <p className="text-2xl font-bold text-white">{totalEvents.toLocaleString()}</p>
                <p className="text-[10px] text-slate-500">Normalized log events</p>
              </div>
            </div>

            {/* Clients Overview Section */}
            <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    Managed Client Workspaces
                  </h2>
                  <p className="text-xs text-slate-400">
                    Live operational metrics and immediate console access for every tenant
                  </p>
                </div>
                {(myRole === 'owner' || myRole === 'admin') && (
                  <button
                    onClick={() => setShowAddClientModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Client
                  </button>
                )}
              </div>

              {clients.length === 0 ? (
                <div className="p-8 text-center rounded-xl bg-slate-950/60 border border-slate-800/60 space-y-3">
                  <Building2 className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-400">No client workspaces onboarded yet.</p>
                  {(myRole === 'owner' || myRole === 'admin') && (
                    <button
                      onClick={() => setShowAddClientModal(true)}
                      className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
                    >
                      Onboard First Client
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-medium">
                        <th className="pb-2.5">Client Name</th>
                        <th className="pb-2.5">Tenant Slug</th>
                        <th className="pb-2.5">Monitored Servers</th>
                        <th className="pb-2.5">Active Threats</th>
                        <th className="pb-2.5">Total Events</th>
                        <th className="pb-2.5">Open Cases</th>
                        <th className="pb-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {clients.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-3 font-medium text-white flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                            {c.name}
                          </td>
                          <td className="py-3 font-mono text-slate-400">{c.slug}</td>
                          <td className="py-3 text-slate-300">
                            <span className="inline-flex items-center gap-1">
                              <Server className="w-3 h-3 text-slate-500" />
                              {c.serverCount || 0}
                            </span>
                          </td>
                          <td className="py-3">
                            {Number(c.activeAlertsCount) > 0 ? (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/50">
                                {c.activeAlertsCount} Active
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-950/40 text-emerald-400 border border-emerald-900/50">
                                Clean
                              </span>
                            )}
                          </td>
                          <td className="py-3 text-slate-400 font-mono">
                            {(Number(c.eventsCount) || 0).toLocaleString()}
                          </td>
                          <td className="py-3 text-slate-400">{c.casesCount || 0}</td>
                          <td className="py-3 text-right">
                            <Link
                              href={`/workspaces/${c.id}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 text-[11px] font-medium transition-colors"
                            >
                              Open Console
                              <ArrowUpRight className="w-3 h-3" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 2: CLIENTS MANAGEMENT
        ========================================================================= */}
        {activeTab === 'clients' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  Client Workspaces Directory
                </h2>
                <p className="text-xs text-slate-400">
                  Manage independent business clients under {org.name}
                </p>
              </div>
              {(myRole === 'owner' || myRole === 'admin') && (
                <button
                  onClick={() => setShowAddClientModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium shadow-md transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Onboard New Client
                </button>
              )}
            </div>

            {clientsError && (
              <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{clientsError}</span>
                </div>
                <button
                  onClick={loadClients}
                  className="px-3 py-1 bg-rose-900 hover:bg-rose-800 text-rose-100 rounded-lg text-xs font-medium transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {clientsLoading ? (
              <div className="p-12 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                Loading clients directory...
              </div>
            ) : clients.length === 0 ? (
              <div className="p-8 text-center rounded-2xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
                No client workspaces onboarded yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {clients.map((c) => (
                  <div
                    key={c.id}
                    className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all space-y-4 flex flex-col justify-between"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] text-slate-500 truncate max-w-[150px]">
                          {c.slug}
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-cyan-950 text-cyan-300 border border-cyan-800/50">
                          Client Workspace
                        </span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-white text-sm">{c.name}</h3>
                        <p className="text-[11px] text-slate-500">ID: {c.id}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/60 text-[11px]">
                        <div>
                          <span className="text-slate-500 block">Monitored Hosts</span>
                          <span className="font-semibold text-slate-200">{c.serverCount || 0} Servers</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Active Threats</span>
                          <span
                            className={`font-semibold ${
                              Number(c.activeAlertsCount) > 0 ? 'text-rose-400' : 'text-emerald-400'
                            }`}
                          >
                            {c.activeAlertsCount || 0} Alerts
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Events Ingested</span>
                          <span className="font-semibold text-slate-200 font-mono">
                            {(Number(c.eventsCount) || 0).toLocaleString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Cases</span>
                          <span className="font-semibold text-slate-200">{c.casesCount || 0}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-800/60 flex items-center justify-end">
                      <Link
                        href={`/workspaces/${c.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 text-xs font-medium transition-colors border border-cyan-700/50"
                      >
                        Launch Workspace Console
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            TAB 3: CONSOLIDATED ALERTS
        ========================================================================= */}
        {activeTab === 'alerts' && (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                  Consolidated Alerts Feed
                </h2>
                <p className="text-xs text-slate-400">
                  Real-time security alerts aggregated across all client workspaces
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {/* Client filter */}
                <select
                  value={alertClientFilter}
                  onChange={(e) => setAlertClientFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="all">All Clients ({clients.length})</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                {/* Severity filter */}
                <select
                  value={alertSeverityFilter}
                  onChange={(e) => setAlertSeverityFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="all">All Severities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                  <option value="info">Info</option>
                </select>

                {/* Status filter */}
                <select
                  value={alertStatusFilter}
                  onChange={(e) => setAlertStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="open">Open</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="resolved">Resolved</option>
                  <option value="dismissed">Dismissed</option>
                </select>
              </div>
            </div>

            {alertsError && (
              <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{alertsError}</span>
                </div>
                <button
                  onClick={loadAlerts}
                  className="px-3 py-1 bg-rose-900 hover:bg-rose-800 text-rose-100 rounded-lg text-xs font-medium transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {alertsLoading ? (
              <div className="p-12 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                Aggregating alerts across clients...
              </div>
            ) : alerts.length === 0 ? (
              <div className="p-8 text-center rounded-2xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
                No security alerts found matching the active filters.
              </div>
            ) : (
              <div className="space-y-3">
                {alerts.map((a) => (
                  <div
                    key={a.id}
                    className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md font-semibold text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800/60">
                          {a.clientName}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase ${
                            a.severity === 'critical'
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : a.severity === 'high'
                              ? 'bg-orange-950 text-orange-300 border border-orange-800'
                              : a.severity === 'medium'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {a.severity}
                        </span>
                        <span className="font-mono text-slate-500 text-[11px]">{a.ruleName}</span>
                        <span className="text-slate-500">•</span>
                        <span className="text-slate-400 text-[11px]">
                          {new Date(a.lastEventAt || a.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <h4 className="font-semibold text-white text-sm">{a.title}</h4>
                      <p className="text-slate-400 text-[11px] line-clamp-2">{a.summary}</p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono text-[11px] text-slate-400">
                        {a.eventCount} {a.eventCount === 1 ? 'event' : 'events'}
                      </span>
                      <Link
                        href={`/workspaces/${a.clientId}?tab=alerts`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 transition-colors font-medium text-[11px]"
                      >
                        Investigate
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            TAB 4: FLEET HEALTH
        ========================================================================= */}
        {activeTab === 'fleet' && (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Server className="w-4 h-4 text-indigo-400" />
                  Consolidated Host Fleet
                </h2>
                <p className="text-xs text-slate-400">
                  Agent health, heartbeats, and ingestion status across all client infrastructure
                </p>
              </div>

              {/* Status summary & Filters */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {fleetSummary && (
                  <div className="flex items-center gap-1.5 mr-2">
                    <span className="px-2 py-0.5 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-[11px]">
                      {fleetSummary.connected} Connected
                    </span>
                    <span className="px-2 py-0.5 rounded-lg bg-amber-950/60 border border-amber-800/60 text-amber-300 text-[11px]">
                      {fleetSummary.degraded} Degraded
                    </span>
                    <span className="px-2 py-0.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 text-[11px]">
                      {fleetSummary.inactive + fleetSummary.disconnected} Inactive
                    </span>
                  </div>
                )}

                {/* Client filter */}
                <select
                  value={fleetClientFilter}
                  onChange={(e) => setFleetClientFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="all">All Clients ({clients.length})</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                {/* Health status filter */}
                <select
                  value={fleetHealthFilter}
                  onChange={(e) => setFleetHealthFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="connected">Connected</option>
                  <option value="degraded">Degraded</option>
                  <option value="disconnected">Disconnected</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            {/* Error Banner */}
            {fleetError && (
              <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{fleetError}</span>
                </div>
                <button
                  onClick={loadFleet}
                  className="px-3 py-1 bg-rose-900 hover:bg-rose-800 text-rose-100 rounded-lg text-xs font-medium transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {fleetLoading ? (
              <div className="p-12 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                Querying fleet heartbeats...
              </div>
            ) : fleetError ? null : (!fleetHosts || !Array.isArray(fleetHosts) || fleetHosts.length === 0) ? (
              <div className="p-8 text-center rounded-2xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
                No agent servers registered under any client workspace.
              </div>
            ) : displayedFleetHosts.length === 0 ? (
              <div className="p-8 text-center rounded-2xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
                No servers match the active filters.
              </div>
            ) : (
              <div className="overflow-x-auto p-4 rounded-2xl bg-slate-900/50 border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-medium">
                      <th className="pb-2.5">Client</th>
                      <th className="pb-2.5">Hostname / Agent</th>
                      <th className="pb-2.5">Health</th>
                      <th className="pb-2.5">OS / Arch</th>
                      <th className="pb-2.5">Agent Version</th>
                      <th className="pb-2.5">Last Heartbeat</th>
                      <th className="pb-2.5 text-right">Console</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {displayedFleetHosts.map((h) => (
                      <tr key={h.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 font-medium text-cyan-400">{h.clientName}</td>
                        <td className="py-3 text-white font-mono">{h.hostname || h.name}</td>
                        <td className="py-3">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase ${
                              h.healthStatus === 'connected'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : h.healthStatus === 'degraded'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : 'bg-slate-800 text-slate-400 border border-slate-700'
                            }`}
                          >
                            {h.healthStatus}
                          </span>
                        </td>
                        <td className="py-3 text-slate-400">
                          {h.os ? `${h.os} (${h.arch || 'x64'})` : 'Linux'}
                        </td>
                        <td className="py-3 font-mono text-slate-400">{h.agentVersion || 'v0.1.0'}</td>
                        <td className="py-3 text-slate-400">
                          {h.lastSeenAt ? new Date(h.lastSeenAt).toLocaleString() : 'Never'}
                        </td>
                        <td className="py-3 text-right">
                          <Link
                            href={`/workspaces/${h.clientId}?tab=integrations`}
                            className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-[11px]"
                          >
                            Manage
                            <ArrowUpRight className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            TAB 5: CONSOLIDATED CASES
        ========================================================================= */}
        {activeTab === 'cases' && (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-amber-400" />
                  Consolidated Incident Cases
                </h2>
                <p className="text-xs text-slate-400">
                  Security investigations active across all client accounts
                </p>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2 text-xs">
                <select
                  value={caseClientFilter}
                  onChange={(e) => setCaseClientFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none"
                >
                  <option value="all">All Clients</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <select
                  value={caseStatusFilter}
                  onChange={(e) => setCaseStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none"
                >
                  <option value="all">All Statuses</option>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="escalated">Escalated</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>

            {casesError && (
              <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{casesError}</span>
                </div>
                <button
                  onClick={loadCases}
                  className="px-3 py-1 bg-rose-900 hover:bg-rose-800 text-rose-100 rounded-lg text-xs font-medium transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {casesLoading ? (
              <div className="p-12 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                Loading consolidated cases...
              </div>
            ) : cases.length === 0 ? (
              <div className="p-8 text-center rounded-2xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
                No security cases found.
              </div>
            ) : (
              <div className="space-y-3">
                {cases.map((cs) => (
                  <div
                    key={cs.id}
                    className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md font-semibold text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800/60">
                          {cs.clientName}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase ${
                            cs.priority === 'critical'
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : cs.priority === 'high'
                              ? 'bg-orange-950 text-orange-300 border border-orange-800'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {cs.priority}
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] bg-slate-800 text-slate-400">
                          {cs.status.replace('_', ' ')}
                        </span>
                        <span className="text-slate-500">•</span>
                        <span className="text-slate-400 text-[11px]">
                          Created: {new Date(cs.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <h4 className="font-semibold text-white text-sm">{cs.title}</h4>
                      <p className="text-slate-400 text-[11px] line-clamp-1">{cs.description}</p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-slate-400 text-[11px]">
                        Assignee: <span className="text-slate-200">{cs.assigneeName || 'Unassigned'}</span>
                      </span>
                      <Link
                        href={`/workspaces/${cs.clientId}?tab=cases`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 font-medium text-[11px]"
                      >
                        Open Case
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            TAB 6: USAGE BREAKDOWN & EXECUTIVE REPORTS
        ========================================================================= */}
        {activeTab === 'usage' && (
          <div className="space-y-6">
            {/* Header with Export */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-cyan-400" />
                  Client Usage & Billing Metrics
                </h2>
                <p className="text-xs text-slate-400">
                  Accurate consumption metrics per client for invoicing and capacity management
                </p>
              </div>

              {report && (
                <button
                  onClick={downloadReportJson}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-medium border border-slate-700 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Executive Summary (JSON)
                </button>
              )}
            </div>

            {/* Usage Error Banner */}
            {usageError && (
              <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{usageError}</span>
                </div>
                <button
                  onClick={loadUsage}
                  className="px-3 py-1 bg-rose-900 hover:bg-rose-800 text-rose-100 rounded-lg text-xs font-medium transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Usage Content */}
            {usageLoading ? (
              <div className="p-12 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                Aggregating client usage metrics...
              </div>
            ) : usageError ? null : (!usageData || !Array.isArray(usageData) || usageData.length === 0) ? (
              <div className="p-8 text-center rounded-2xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
                No usage metrics available for client workspaces.
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-medium">
                      <th className="pb-2.5">Client Workspace</th>
                      <th className="pb-2.5">Total Events</th>
                      <th className="pb-2.5">24h Ingestion</th>
                      <th className="pb-2.5">Datasets</th>
                      <th className="pb-2.5">Total Alerts</th>
                      <th className="pb-2.5">Cases</th>
                      <th className="pb-2.5">AI Investigations</th>
                      <th className="pb-2.5">Monitored Servers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {usageData.map((u) => {
                      const totalEvents = u.metrics?.totalEvents ?? u.totalEvents ?? 0;
                      const eventsLast24h = u.metrics?.eventsLast24h ?? u.eventsLast24h ?? 0;
                      const datasetsCount = u.metrics?.datasetsCount ?? u.datasetsCount ?? 0;
                      const totalAlerts = u.metrics?.totalAlerts ?? u.totalAlerts ?? 0;
                      const openAlerts = u.metrics?.openAlerts ?? u.openAlerts ?? 0;
                      const totalCases = u.metrics?.totalCases ?? u.totalCases ?? 0;
                      const aiInvestigations = u.metrics?.aiInvestigationsCount ?? u.aiInvestigationsCount ?? 0;
                      const activeServers = u.metrics?.activeServers ?? u.activeServers ?? 0;
                      const totalServers = u.metrics?.totalServers ?? activeServers;

                      return (
                        <tr key={u.clientId} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-3 font-medium text-white">
                            {u.clientName}
                            <span className="block font-mono text-[10px] text-slate-500">{u.clientSlug}</span>
                          </td>
                          <td className="py-3 font-mono text-cyan-300">
                            {totalEvents.toLocaleString()}
                          </td>
                          <td className="py-3 font-mono text-emerald-400">
                            +{eventsLast24h.toLocaleString()}
                          </td>
                          <td className="py-3 text-slate-300">{datasetsCount}</td>
                          <td className="py-3">
                            <span className="text-slate-200">{totalAlerts}</span>
                            {openAlerts > 0 && (
                              <span className="ml-1 text-[10px] text-rose-400">({openAlerts} open)</span>
                            )}
                          </td>
                          <td className="py-3 text-slate-300">{totalCases}</td>
                          <td className="py-3 font-semibold text-purple-300">
                            {aiInvestigations}
                          </td>
                          <td className="py-3 text-slate-300">
                            {activeServers} / {totalServers}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Report Error Banner */}
            {reportError && (
              <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{reportError}</span>
                </div>
                <button
                  onClick={loadReport}
                  className="px-3 py-1 bg-rose-900 hover:bg-rose-800 text-rose-100 rounded-lg text-xs font-medium transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Executive Report Card */}
            {reportLoading ? (
              <div className="p-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2 rounded-2xl bg-slate-900/30 border border-slate-800">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                Generating consolidated executive summary...
              </div>
            ) : report ? (
              <div className="p-5 rounded-2xl bg-cyan-950/20 border border-cyan-800/40 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400" />
                    Consolidated Executive Summary (Last 30 Days)
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    Generated: {report.generatedAt ? new Date(report.generatedAt).toLocaleString() : 'Just now'}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 text-[10px]">Managed Clients</span>
                    <p className="text-lg font-bold text-white">
                      {report.totals?.clientsCount ?? report.summary?.totalClientsMonitored ?? 0}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 text-[10px]">Active Monitored Servers</span>
                    <p className="text-lg font-bold text-emerald-400">
                      {report.totals?.activeServers ?? report.summary?.totalActiveServers ?? 0} /{' '}
                      {report.totals?.totalServers ?? report.summary?.totalActiveServers ?? 0}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 text-[10px]">Total Events Ingested</span>
                    <p className="text-lg font-bold text-cyan-300 font-mono">
                      {(report.totals?.totalEvents ?? report.summary?.totalEventsAnalyzed ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-400 text-[10px]">AI Threat Analyses</span>
                    <p className="text-lg font-bold text-purple-300">
                      {report.totals?.aiInvestigations ?? 0}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* =========================================================================
            TAB 7: MSP STAFF & RBAC PERMISSIONS
        ========================================================================= */}
        {activeTab === 'members' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-cyan-400" />
                  MSP Staff & Role Permissions
                </h2>
                <p className="text-xs text-slate-400">
                  Staff members have scoped administrative access across all client workspaces under this organization
                </p>
              </div>
              {(myRole === 'owner' || myRole === 'admin') && (
                <button
                  onClick={() => setShowAddMemberModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium shadow-md transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Staff Member
                </button>
              )}
            </div>

            {membersError && (
              <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{membersError}</span>
                </div>
                <button
                  onClick={loadMembers}
                  className="px-3 py-1 bg-rose-900 hover:bg-rose-800 text-rose-100 rounded-lg text-xs font-medium transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {membersLoading ? (
              <div className="p-12 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                Loading staff members...
              </div>
            ) : members.length === 0 ? (
              <div className="p-8 text-center rounded-2xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
                No staff members found.
              </div>
            ) : (
              <div className="overflow-x-auto p-4 rounded-2xl bg-slate-900/50 border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-medium">
                      <th className="pb-2.5">User</th>
                      <th className="pb-2.5">Email Verification</th>
                      <th className="pb-2.5">MSP Organization Role</th>
                      <th className="pb-2.5">Joined Date</th>
                      {(myRole === 'owner' || myRole === 'admin') && (
                        <th className="pb-2.5 text-right">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {members.map((m) => (
                      <tr key={m.user_id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 font-medium text-white">
                          {m.full_name || m.email}
                          <span className="block text-[11px] text-slate-400">{m.email}</span>
                        </td>
                        <td className="py-3">
                          {m.is_verified ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">
                              <CheckCircle2 className="w-3 h-3" />
                              Verified
                            </span>
                          ) : (
                            <span className="text-[10px] text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40">
                              Unverified
                            </span>
                          )}
                        </td>
                        <td className="py-3">
                          {myRole === 'owner' && m.role !== 'owner' ? (
                            <select
                              value={m.role}
                              onChange={(e) =>
                                handleUpdateRole(m.user_id, e.target.value as 'admin' | 'analyst' | 'viewer')
                              }
                              className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs"
                            >
                              <option value="admin">Admin</option>
                              <option value="analyst">Analyst</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          ) : (
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase ${
                                m.role === 'owner'
                                  ? 'bg-purple-950 text-purple-300 border border-purple-800'
                                  : m.role === 'admin'
                                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                                  : m.role === 'analyst'
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {m.role}
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-slate-400">
                          {new Date(m.joined_at).toLocaleDateString()}
                        </td>
                        {(myRole === 'owner' || myRole === 'admin') && (
                          <td className="py-3 text-right">
                            {m.role !== 'owner' && (
                              <button
                                onClick={() => handleRemoveMember(m.user_id)}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 transition-colors"
                                title="Remove member"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            MODAL: ONBOARD NEW CLIENT
        ========================================================================= */}
        {showAddClientModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Onboard New Client Workspace</h3>
                <button
                  onClick={() => setShowAddClientModal(false)}
                  className="text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>

              {createClientError && (
                <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200">
                  {createClientError}
                </div>
              )}

              <form onSubmit={handleCreateClient} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">Client Organization Name</label>
                  <input
                    type="text"
                    required
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="e.g. Wayne Enterprises"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">Tenant Slug (Optional)</label>
                  <input
                    type="text"
                    value={newClientSlug}
                    onChange={(e) => setNewClientSlug(e.target.value)}
                    placeholder="e.g. wayne-enterprises"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                  <p className="text-[10px] text-slate-500">
                    If blank, a unique url-friendly slug will be automatically derived from the name.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddClientModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingClient}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    {creatingClient ? 'Onboarding...' : 'Create Client Workspace'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* =========================================================================
            MODAL: ADD STAFF MEMBER
        ========================================================================= */}
        {showAddMemberModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Add MSP Staff Member</h3>
                <button
                  onClick={() => setShowAddMemberModal(false)}
                  className="text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>

              {memberError && (
                <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200">
                  {memberError}
                </div>
              )}

              <form onSubmit={handleAddMember} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">User Email</label>
                  <input
                    type="email"
                    required
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    placeholder="analyst@msp-provider.com"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">Role</label>
                  <select
                    value={newMemberRole}
                    onChange={(e) =>
                      setNewMemberRole(e.target.value as 'admin' | 'analyst' | 'viewer')
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="admin">Admin (Can onboard clients and manage staff)</option>
                    <option value="analyst">Analyst (Investigate alerts, run AI, manage cases)</option>
                    <option value="viewer">Viewer (Read-only access across all clients)</option>
                  </select>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddMemberModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={addingMember}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    {addingMember ? 'Adding...' : 'Add Member'}
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

