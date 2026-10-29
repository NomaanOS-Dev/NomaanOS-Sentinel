'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { 
  Building, 
  Users, 
  ShieldAlert, 
  Plus, 
  ArrowLeft, 
  Trash2, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  Lock, 
  Layers, 
  Activity, 
  UploadCloud, 
  RefreshCw, 
  Download,
  ChevronDown,
  ChevronRight,
  Search,
  Filter,
  LayoutDashboard,
  X,
  ArrowUpRight,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  Briefcase,
  FileText,
  MessageSquare,
  Clock,
  Send,
  Link as LinkIcon,
  Sparkles,
  Bot,
  HelpCircle,
  Lightbulb,
  Copy,
  Check,
  Server,
  Terminal,
  Key,
  Shield,
  Info,
  Bell,
  Mail,
  Building2,
  CreditCard,
  Zap
} from 'lucide-react';
import { 
  apiRequest, 
  WorkspaceMember, 
  DatasetSummary, 
  SecurityEvent, 
  AlertSummary, 
  AlertDetail,
  WorkspaceDashboardData,
  PaginatedEventsResponse,
  PaginatedAlertsResponse,
  CaseSummary,
  CaseDetail,
  PaginatedCasesResponse,
  AiInvestigationRecord,
  runAiInvestigation,
  getLatestAiInvestigation,
  IntegrationSummary,
  IntegrationAuditLog,
  fetchIntegrations,
  createIntegration,
  fetchIntegrationDetail,
  initiateEnrollment,
  revokeIntegration,
  fetchIntegrationHealth,
  fetchNotificationSettings,
  updateNotificationSettings,
  fetchNotificationHistory,
  sendTestNotification,
  IntegrationHealthSummary,
  MonitoredHostIntegration,
  WorkspaceNotificationSettings,
  NotificationHistoryRecord,
  fetchOrganizationClients,
  MspClientSummary
} from '@/lib/api';

interface WorkspaceDetail {
  id: string;
  name: string;
  slug: string;
  createdBy: string;
  organizationId?: string | null;
  organization?: {
    id: string;
    name: string;
    slug: string;
  } | null;
  myRole: 'owner' | 'admin' | 'analyst' | 'viewer';
}

interface InvestigationContext {
  alertId: string;
  alertTitle: string;
  ruleId: string;
  eventId: string;
}

export default function WorkspaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.workspaceId as string;

  // Navigation & Workspace State
  const [activeTab, setActiveTab] = useState<'overview' | 'alerts' | 'cases' | 'datasets' | 'events' | 'members' | 'integrations' | 'notifications'>('overview');
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Integrations & Assets State
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([]);
  const [fleetHealthSummary, setFleetHealthSummary] = useState<IntegrationHealthSummary | null>(null);
  const [fleetIntegrations, setFleetIntegrations] = useState<MonitoredHostIntegration[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [integrationsError, setIntegrationsError] = useState<string | null>(null);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<string | null>(null);
  const [selectedIntegrationDetail, setSelectedIntegrationDetail] = useState<IntegrationSummary | null>(null);
  const [integrationAuditLogs, setIntegrationAuditLogs] = useState<IntegrationAuditLog[]>([]);
  const [loadingIntegrationDetail, setLoadingIntegrationDetail] = useState(false);
  const [showAddIntegrationModal, setShowAddIntegrationModal] = useState(false);
  const [newIntegrationName, setNewIntegrationName] = useState('');
  const [newIntegrationEnv, setNewIntegrationEnv] = useState('production');
  const [creatingIntegration, setCreatingIntegration] = useState(false);
  const [activeEnrollmentToken, setActiveEnrollmentToken] = useState<{
    token: string;
    expiresAt: string;
    warning: string;
  } | null>(null);
  const [initiatingEnrollment, setInitiatingEnrollment] = useState(false);

  // Alert Notifications State
  const [notificationSettings, setNotificationSettings] = useState<WorkspaceNotificationSettings | null>(null);
  const [notificationHistory, setNotificationHistory] = useState<NotificationHistoryRecord[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsSaving, setNotificationsSaving] = useState(false);
  const [newEmailInput, setNewEmailInput] = useState('');
  const [testEmailLoading, setTestEmailLoading] = useState(false);
  const [revokingIntegration, setRevokingIntegration] = useState(false);
  const [copiedEnrollmentToken, setCopiedEnrollmentToken] = useState(false);

  // Overview Dashboard State
  const [dashboardData, setDashboardData] = useState<WorkspaceDashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  // Alerts State & Filters
  const [alerts, setAlerts] = useState<AlertSummary[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertStatusFilter, setAlertStatusFilter] = useState<'all' | 'open' | 'acknowledged' | 'resolved' | 'dismissed'>('all');
  const [alertSeverityFilter, setAlertSeverityFilter] = useState<string>('all');
  const [alertRuleFilter, setAlertRuleFilter] = useState<string>('all');
  const [alertFromFilter, setAlertFromFilter] = useState<string>('');
  const [alertToFilter, setAlertToFilter] = useState<string>('');
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [alertDetails, setAlertDetails] = useState<Record<string, AlertDetail>>({});
  const [loadingAlertId, setLoadingAlertId] = useState<string | null>(null);
  const [updatingAlertId, setUpdatingAlertId] = useState<string | null>(null);
  const [creatingCaseForAlertId, setCreatingCaseForAlertId] = useState<string | null>(null);

  // Investigation Cases State
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [casesError, setCasesError] = useState<string | null>(null);
  const [casesTotal, setCasesTotal] = useState(0);
  const [casesPage, setCasesPage] = useState(1);
  const [casesLimit, setCasesLimit] = useState(50);
  const [casesTotalPages, setCasesTotalPages] = useState(1);
  const [caseStatusFilter, setCaseStatusFilter] = useState<string>('all');
  const [casePriorityFilter, setCasePriorityFilter] = useState<string>('all');
  const [caseAssigneeFilter, setCaseAssigneeFilter] = useState<string>('all');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedCaseDetail, setSelectedCaseDetail] = useState<CaseDetail | null>(null);
  const [loadingCaseDetail, setLoadingCaseDetail] = useState(false);
  const [updatingCaseStatus, setUpdatingCaseStatus] = useState(false);
  const [updatingCaseAssignee, setUpdatingCaseAssignee] = useState(false);

  // New Case Modal State
  const [showNewCaseModal, setShowNewCaseModal] = useState(false);
  const [newCaseTitle, setNewCaseTitle] = useState('');
  const [newCaseDescription, setNewCaseDescription] = useState('');
  const [newCasePriority, setNewCasePriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [newCaseAssigneeId, setNewCaseAssigneeId] = useState<string>('');
  const [newCaseLoading, setNewCaseLoading] = useState(false);

  // Case Notes State
  const [newNoteContent, setNewNoteContent] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  // Link Alert Modal State
  const [showLinkAlertModal, setShowLinkAlertModal] = useState(false);
  const [linkAlertId, setLinkAlertId] = useState('');
  const [linkingAlert, setLinkingAlert] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);

  // AI Investigation Assistant State
  const [aiInvestigation, setAiInvestigation] = useState<AiInvestigationRecord | null>(null);
  const [loadingAiInvestigation, setLoadingAiInvestigation] = useState(false);
  const [aiInvestigationError, setAiInvestigationError] = useState<string | null>(null);
  const [copiedDraft, setCopiedDraft] = useState(false);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);

  // Events Explorer State & Filters
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsLimit, setEventsLimit] = useState(50);
  const [eventsTotalPages, setEventsTotalPages] = useState(1);
  const [eventSearchInput, setEventSearchInput] = useState('');
  const [eventSearchQuery, setEventSearchQuery] = useState('');
  const [eventSeverityFilter, setEventSeverityFilter] = useState('all');
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [eventFromFilter, setEventFromFilter] = useState('');
  const [eventToFilter, setEventToFilter] = useState('');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  // Cross-Navigation Context (Alert to Event Investigation)
  const [investigationContext, setInvestigationContext] = useState<InvestigationContext | null>(null);

  // Datasets State
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Members State
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'admin' | 'analyst' | 'viewer'>('analyst');
  const [addLoading, setAddLoading] = useState(false);

  // MSP Multi-Client Sibling Workspaces State
  const [siblingClients, setSiblingClients] = useState<MspClientSummary[]>([]);

  // 1. Fetch Workspace Summary
  const fetchWorkspace = useCallback(async () => {
    const wsRes = await apiRequest<{ workspace: WorkspaceDetail }>(`/api/v1/workspaces/${workspaceId}`);
    if (wsRes.status === 401) {
      router.push('/login');
      return null;
    }
    if (wsRes.error || !wsRes.data) {
      setError(wsRes.error || 'Failed to load workspace.');
      return null;
    }
    setWorkspace(wsRes.data.workspace);
    return wsRes.data.workspace;
  }, [workspaceId, router]);

  // 2. Fetch Dashboard Overview Metrics
  const fetchDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError(null);
    const res = await apiRequest<WorkspaceDashboardData>(`/api/v1/workspaces/${workspaceId}/dashboard`);
    setDashboardLoading(false);
    if (res.data) {
      setDashboardData(res.data);
    } else if (res.error) {
      setDashboardError(res.error);
    }
  }, [workspaceId]);

  // 3. Fetch Security Alerts with Filters
  const fetchAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsError(null);
    const params = new URLSearchParams();
    if (alertStatusFilter !== 'all') params.set('status', alertStatusFilter);
    if (alertSeverityFilter !== 'all') params.set('severity', alertSeverityFilter);
    if (alertRuleFilter !== 'all') params.set('rule_id', alertRuleFilter);
    if (alertFromFilter) params.set('from', new Date(alertFromFilter).toISOString());
    if (alertToFilter) params.set('to', new Date(alertToFilter).toISOString());

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const res = await apiRequest<PaginatedAlertsResponse>(`/api/v1/workspaces/${workspaceId}/alerts${queryString}`);
    setAlertsLoading(false);
    if (res.data) {
      setAlerts(res.data.alerts);
      setAlertsTotal(res.data.total);
    } else if (res.error) {
      setAlertsError(res.error);
    }
  }, [workspaceId, alertStatusFilter, alertSeverityFilter, alertRuleFilter, alertFromFilter, alertToFilter]);

  // 4. Fetch Cases
  const fetchCases = useCallback(async () => {
    setCasesLoading(true);
    setCasesError(null);
    const params = new URLSearchParams();
    params.set('page', String(casesPage));
    params.set('limit', String(casesLimit));
    if (caseStatusFilter !== 'all') params.set('status', caseStatusFilter);
    if (casePriorityFilter !== 'all') params.set('priority', casePriorityFilter);
    if (caseAssigneeFilter !== 'all') params.set('assignee_id', caseAssigneeFilter);

    const res = await apiRequest<PaginatedCasesResponse>(`/api/v1/workspaces/${workspaceId}/cases?${params.toString()}`);
    setCasesLoading(false);
    if (res.data) {
      setCases(res.data.cases);
      setCasesTotal(res.data.total);
      setCasesTotalPages(res.data.totalPages || 1);
    } else if (res.error) {
      setCasesError(res.error);
    }
  }, [workspaceId, casesPage, casesLimit, caseStatusFilter, casePriorityFilter, caseAssigneeFilter]);

  // 5. Fetch Single Case Detail
  const fetchCaseDetail = useCallback(async (caseId: string) => {
    setLoadingCaseDetail(true);
    setAiInvestigationError(null);
    const res = await apiRequest<{ case: CaseDetail }>(`/api/v1/workspaces/${workspaceId}/cases/${caseId}`);
    setLoadingCaseDetail(false);
    if (res.data) {
      setSelectedCaseDetail(res.data.case);
      try {
        const aiRes = await getLatestAiInvestigation(workspaceId, caseId);
        if (aiRes.data?.investigation) {
          setAiInvestigation(aiRes.data.investigation);
        } else {
          setAiInvestigation(null);
        }
      } catch {
        setAiInvestigation(null);
      }
    } else if (res.error) {
      setActionMessage(`Error loading case: ${res.error}`);
    }
  }, [workspaceId]);

  // AI Assistant Handlers
  const handleTriggerAiInvestigation = async (caseId: string) => {
    setLoadingAiInvestigation(true);
    setAiInvestigationError(null);
    try {
      const res = await runAiInvestigation(workspaceId, caseId);
      if (res.error) {
        setAiInvestigationError(res.error);
      } else if (res.data?.investigation) {
        setAiInvestigation(res.data.investigation);
        await fetchCaseDetail(caseId);
      }
    } catch (err: any) {
      setAiInvestigationError(err.message || 'Failed to complete AI investigation');
    } finally {
      setLoadingAiInvestigation(false);
    }
  };

  const handleCopyDraft = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedDraft(true);
      setTimeout(() => setCopiedDraft(false), 2000);
    }
  };

  const handleJumpToEvent = (eventId: string) => {
    setHighlightedEventId(eventId);
    if (typeof document !== 'undefined') {
      const el = document.getElementById(`case-event-${eventId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    setTimeout(() => setHighlightedEventId(null), 3000);
  };

  // 6. Fetch Security Events with Search, Filters, and Pagination
  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    const params = new URLSearchParams();
    params.set('page', String(eventsPage));
    params.set('limit', String(eventsLimit));
    if (eventSearchQuery) params.set('search', eventSearchQuery);
    if (eventSeverityFilter !== 'all') params.set('severity', eventSeverityFilter);
    if (eventTypeFilter !== 'all') params.set('event_type', eventTypeFilter);
    if (eventFromFilter) params.set('from', new Date(eventFromFilter).toISOString());
    if (eventToFilter) params.set('to', new Date(eventToFilter).toISOString());

    const res = await apiRequest<PaginatedEventsResponse>(`/api/v1/workspaces/${workspaceId}/events?${params.toString()}`);
    setEventsLoading(false);
    if (res.data) {
      setEvents(res.data.events);
      setEventsTotal(res.data.total);
      setEventsTotalPages(res.data.totalPages || 1);
    } else if (res.error) {
      setEventsError(res.error);
    }
  }, [workspaceId, eventsPage, eventsLimit, eventSearchQuery, eventSeverityFilter, eventTypeFilter, eventFromFilter, eventToFilter]);

  // 7. Fetch Datasets
  const fetchDatasets = useCallback(async () => {
    const dsRes = await apiRequest<{ datasets: DatasetSummary[] }>(`/api/v1/workspaces/${workspaceId}/datasets`);
    if (dsRes.data) {
      setDatasets(dsRes.data.datasets);
    }
  }, [workspaceId]);

  // 8. Fetch Members
  const fetchMembers = useCallback(async () => {
    const membersRes = await apiRequest<{ members: WorkspaceMember[] }>(`/api/v1/workspaces/${workspaceId}/members`);
    if (membersRes.data) {
      setMembers(membersRes.data.members);
    }
  }, [workspaceId]);

  // 9. Fetch Integrations & Monitored Assets Fleet Health
  const fetchIntegrationsList = useCallback(async () => {
    setIntegrationsLoading(true);
    setIntegrationsError(null);
    const [res, healthRes] = await Promise.all([
      fetchIntegrations(workspaceId),
      fetchIntegrationHealth(workspaceId),
    ]);
    setIntegrationsLoading(false);
    if (res.data) {
      setIntegrations(res.data.integrations);
    } else if (res.error) {
      setIntegrationsError(res.error);
    }
    if (healthRes.data) {
      setFleetHealthSummary(healthRes.data.summary);
      if (healthRes.data.integrations) {
        setFleetIntegrations(healthRes.data.integrations);
      }
    }
  }, [workspaceId]);

  // 10. Fetch Single Integration Detail
  const fetchIntegrationDetailData = useCallback(async (intId: string) => {
    setLoadingIntegrationDetail(true);
    const res = await fetchIntegrationDetail(workspaceId, intId);
    setLoadingIntegrationDetail(false);
    if (res.data) {
      setSelectedIntegrationDetail(res.data.integration);
      setIntegrationAuditLogs(res.data.auditLogs);
    } else if (res.error) {
      setActionMessage(`Error loading integration: ${res.error}`);
    }
  }, [workspaceId]);

  // 11. Fetch Workspace Alert Notification Preferences & Delivery History
  const fetchNotificationData = useCallback(async () => {
    setNotificationsLoading(true);
    const [settingsRes, historyRes] = await Promise.all([
      fetchNotificationSettings(workspaceId),
      fetchNotificationHistory(workspaceId),
    ]);
    setNotificationsLoading(false);
    if (settingsRes.data) {
      setNotificationSettings(settingsRes.data.settings);
    }
    if (historyRes.data) {
      setNotificationHistory(historyRes.data.notifications);
    }
  }, [workspaceId]);

  // Initial Load
  useEffect(() => {
    let isMounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      const ws = await fetchWorkspace();
      if (!ws) {
        if (isMounted) setLoading(false);
        return;
      }
      await Promise.all([
        fetchDashboard(),
        fetchAlerts(),
        fetchCases(),
        fetchEvents(),
        fetchDatasets(),
        fetchIntegrationsList(),
        ws.myRole !== 'viewer' ? fetchMembers() : Promise.resolve(),
      ]);
      if (isMounted) setLoading(false);
    })();
    return () => {
      isMounted = false;
    };
  }, [fetchWorkspace, fetchDashboard, fetchAlerts, fetchCases, fetchEvents, fetchDatasets, fetchIntegrationsList, fetchMembers]);

  // Fetch sibling clients if workspace belongs to an MSP Organization
  useEffect(() => {
    if (workspace?.organizationId) {
      fetchOrganizationClients(workspace.organizationId).then((res) => {
        if (res.data?.clients) {
          setSiblingClients(res.data.clients);
        }
      });
    } else {
      setSiblingClients([]);
    }
  }, [workspace?.organizationId]);

  // Active Tab Refresh Hooks
  useEffect(() => {
    if (activeTab === 'overview') {
      fetchDashboard();
    } else if (activeTab === 'alerts') {
      fetchAlerts();
    } else if (activeTab === 'cases') {
      if (selectedCaseId) {
        fetchCaseDetail(selectedCaseId);
      } else {
        fetchCases();
      }
    } else if (activeTab === 'events') {
      fetchEvents();
    } else if (activeTab === 'datasets') {
      fetchDatasets();
    } else if (activeTab === 'integrations') {
      if (selectedIntegrationId) {
        fetchIntegrationDetailData(selectedIntegrationId);
      } else {
        fetchIntegrationsList();
      }
    } else if (activeTab === 'notifications') {
      fetchNotificationData();
    } else if (activeTab === 'members' && workspace?.myRole !== 'viewer') {
      fetchMembers();
    }
  }, [activeTab, selectedCaseId, selectedIntegrationId, fetchDashboard, fetchAlerts, fetchCases, fetchCaseDetail, fetchEvents, fetchDatasets, fetchIntegrationsList, fetchIntegrationDetailData, fetchNotificationData, fetchMembers, workspace?.myRole]);

  // Background dataset polling
  useEffect(() => {
    const hasPendingDatasets = datasets.some(
      (d) => d.status === 'queued' || d.status === 'processing'
    );
    if (!hasPendingDatasets) return;

    const timer = setInterval(() => {
      fetchDatasets();
      fetchDashboard();
      fetchAlerts();
      fetchCases();
      fetchEvents();
    }, 3000);

    return () => clearInterval(timer);
  }, [datasets, fetchDatasets, fetchDashboard, fetchAlerts, fetchCases, fetchEvents]);

  // Case Handlers
  const handleCreateCaseFromAlert = async (alert: AlertSummary) => {
    setCreatingCaseForAlertId(alert.id);
    setActionMessage(null);

    const res = await apiRequest<{ case: CaseSummary }>(
      `/api/v1/workspaces/${workspaceId}/cases`,
      {
        method: 'POST',
        body: JSON.stringify({
          alertId: alert.id,
          idempotencyKey: `alert-${alert.id}`,
        }),
      }
    );

    setCreatingCaseForAlertId(null);

    if (res.data) {
      setActionMessage(`Investigation case created for "${alert.title}".`);
      setSelectedCaseId(res.data.case.id);
      await fetchCaseDetail(res.data.case.id);
      setActiveTab('cases');
      fetchDashboard();
      fetchCases();
    } else if (res.error) {
      setActionMessage(`Failed to create case: ${res.error}`);
    }
  };

  const handleCreateCustomCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCaseTitle.trim()) return;

    setNewCaseLoading(true);
    setActionMessage(null);

    const res = await apiRequest<{ case: CaseSummary }>(
      `/api/v1/workspaces/${workspaceId}/cases`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: newCaseTitle.trim(),
          description: newCaseDescription.trim(),
          priority: newCasePriority,
          assigneeId: newCaseAssigneeId || null,
        }),
      }
    );

    setNewCaseLoading(false);

    if (res.data) {
      setShowNewCaseModal(false);
      setNewCaseTitle('');
      setNewCaseDescription('');
      setNewCaseAssigneeId('');
      setActionMessage('Investigation case created successfully.');
      setSelectedCaseId(res.data.case.id);
      await fetchCaseDetail(res.data.case.id);
      fetchDashboard();
      fetchCases();
    } else if (res.error) {
      setActionMessage(`Failed to create case: ${res.error}`);
    }
  };

  const handleUpdateCaseStatus = async (caseId: string, newStatus: string) => {
    setUpdatingCaseStatus(true);
    setActionMessage(null);

    const res = await apiRequest<{ case: CaseDetail }>(
      `/api/v1/workspaces/${workspaceId}/cases/${caseId}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      }
    );

    setUpdatingCaseStatus(false);

    if (res.data) {
      setActionMessage(`Case status updated to '${newStatus}'.`);
      await fetchCaseDetail(caseId);
      fetchCases();
      fetchDashboard();
    } else if (res.error) {
      setActionMessage(`Failed to update status: ${res.error}`);
    }
  };

  const handleUpdateCaseAssignee = async (caseId: string, newAssigneeId: string | null) => {
    setUpdatingCaseAssignee(true);
    setActionMessage(null);

    const res = await apiRequest<{ case: CaseDetail }>(
      `/api/v1/workspaces/${workspaceId}/cases/${caseId}/assignee`,
      {
        method: 'PATCH',
        body: JSON.stringify({ assigneeId: newAssigneeId || null }),
      }
    );

    setUpdatingCaseAssignee(false);

    if (res.data) {
      setActionMessage(newAssigneeId ? 'Case assigned successfully.' : 'Case unassigned.');
      await fetchCaseDetail(caseId);
      fetchCases();
    } else if (res.error) {
      setActionMessage(`Failed to update assignment: ${res.error}`);
    }
  };

  const handleAddCaseNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId || !newNoteContent.trim()) return;

    setAddingNote(true);
    setActionMessage(null);

    const res = await apiRequest(
      `/api/v1/workspaces/${workspaceId}/cases/${selectedCaseId}/notes`,
      {
        method: 'POST',
        body: JSON.stringify({ content: newNoteContent.trim() }),
      }
    );

    setAddingNote(false);

    if (res.data) {
      setNewNoteContent('');
      setActionMessage('Investigation note recorded.');
      await fetchCaseDetail(selectedCaseId);
    } else if (res.error) {
      setActionMessage(`Failed to add note: ${res.error}`);
    }
  };

  const handleDeleteCaseNote = async (noteId: string) => {
    if (!selectedCaseId) return;
    if (!confirm('Are you sure you want to delete this investigation note?')) return;

    setDeletingNoteId(noteId);
    setActionMessage(null);

    const res = await apiRequest(
      `/api/v1/workspaces/${workspaceId}/cases/${selectedCaseId}/notes/${noteId}`,
      { method: 'DELETE' }
    );

    setDeletingNoteId(null);

    if (res.data) {
      setActionMessage('Investigation note removed.');
      await fetchCaseDetail(selectedCaseId);
    } else if (res.error) {
      setActionMessage(`Failed to delete note: ${res.error}`);
    }
  };

  const handleLinkAlertToCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId || !linkAlertId) return;

    setLinkingAlert(true);
    setActionMessage(null);

    const res = await apiRequest(
      `/api/v1/workspaces/${workspaceId}/cases/${selectedCaseId}/alerts`,
      {
        method: 'POST',
        body: JSON.stringify({ alertId: linkAlertId }),
      }
    );

    setLinkingAlert(false);

    if (res.data) {
      setShowLinkAlertModal(false);
      setLinkAlertId('');
      setActionMessage('Alert linked to case successfully.');
      await fetchCaseDetail(selectedCaseId);
      fetchCases();
    } else if (res.error) {
      setActionMessage(`Failed to link alert: ${res.error}`);
    }
  };

  const handleExportCaseReport = async (caseId: string) => {
    setExportingReport(true);
    setActionMessage(null);

    try {
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/cases/${caseId}/export?format=json`, {
        credentials: 'include',
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        setActionMessage(`Export failed: ${errJson?.message || res.statusText}`);
        setExportingReport(false);
        return;
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = blobUrl;
      downloadLink.download = `investigation-case-${caseId.slice(0, 8)}.json`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(downloadLink);

      setActionMessage('Investigation report downloaded successfully.');
      if (selectedCaseId === caseId) {
        await fetchCaseDetail(caseId);
      }
    } catch (err: any) {
      setActionMessage(`Export error: ${err.message}`);
    } finally {
      setExportingReport(false);
    }
  };

  const handleToggleAlertEvidence = async (alertId: string) => {
    if (selectedAlertId === alertId) {
      setSelectedAlertId(null);
      return;
    }
    setSelectedAlertId(alertId);
    if (!alertDetails[alertId]) {
      setLoadingAlertId(alertId);
      const res = await apiRequest<{ alert: AlertDetail }>(`/api/v1/workspaces/${workspaceId}/alerts/${alertId}`);
      if (res.data) {
        setAlertDetails((prev) => ({ ...prev, [alertId]: res.data!.alert }));
      }
      setLoadingAlertId(null);
    }
  };

  const handleUpdateAlertStatus = async (alertId: string, newStatus: string) => {
    setUpdatingAlertId(alertId);
    setActionMessage(null);
    const res = await apiRequest<{ alert: { id: string; status: string } }>(
      `/api/v1/workspaces/${workspaceId}/alerts/${alertId}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      }
    );
    if (res.data) {
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, status: newStatus } : a))
      );
      if (alertDetails[alertId]) {
        setAlertDetails((prev) => ({
          ...prev,
          [alertId]: { ...prev[alertId], status: newStatus },
        }));
      }
      setActionMessage(`Alert status updated to '${newStatus}'.`);
      fetchDashboard();
    } else if (res.error) {
      setActionMessage(`Failed to update alert: ${res.error}`);
    }
    setUpdatingAlertId(null);
  };

  const handleJumpToEventInvestigation = (alert: AlertSummary | AlertDetail, eventId: string) => {
    setInvestigationContext({
      alertId: alert.id,
      alertTitle: alert.title,
      ruleId: alert.ruleId,
      eventId: eventId,
    });
    setExpandedEventId(eventId);
    setActiveTab('events');
  };

  const handleReturnToAlert = () => {
    if (investigationContext) {
      setSelectedAlertId(investigationContext.alertId);
      setActiveTab('alerts');
    }
  };

  const handleClearInvestigation = () => {
    setInvestigationContext(null);
  };

  const handleExecuteEventSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setEventsPage(1);
    setEventSearchQuery(eventSearchInput);
  };

  const handleClearEventFilters = () => {
    setEventSearchInput('');
    setEventSearchQuery('');
    setEventSeverityFilter('all');
    setEventTypeFilter('all');
    setEventFromFilter('');
    setEventToFilter('');
    setEventsPage(1);
  };

  const handleClearAlertFilters = () => {
    setAlertStatusFilter('all');
    setAlertSeverityFilter('all');
    setAlertRuleFilter('all');
    setAlertFromFilter('');
    setAlertToFilter('');
  };

  const handleFileUpload = async (file: File) => {
    setUploadError(null);
    setUploadSuccess(null);

    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (ext !== '.log' && ext !== '.txt') {
      setUploadError('Invalid file type. Only .log and .txt plain-text files are supported.');
      return;
    }

    if (file.size === 0) {
      setUploadError('The selected file is empty (0 bytes).');
      return;
    }

    const maxBytes = 5 * 1024 * 1024; // 5 MiB
    if (file.size > maxBytes) {
      setUploadError(`File size (${(file.size / (1024 * 1024)).toFixed(2)} MiB) exceeds the 5 MiB maximum limit.`);
      return;
    }

    setUploadLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    const res = await apiRequest<{ dataset: DatasetSummary }>(
      `/api/v1/workspaces/${workspaceId}/datasets`,
      {
        method: 'POST',
        body: formData,
      }
    );

    setUploadLoading(false);

    if (res.error) {
      setUploadError(res.error);
      return;
    }

    setUploadSuccess(`Log file "${file.name}" uploaded successfully and queued for background detection.`);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    await fetchDatasets();
    await fetchDashboard();
  };

  const handleRetryDataset = async (datasetId: string) => {
    setRetryingId(datasetId);
    setActionMessage(null);
    const res = await apiRequest<{ message?: string }>(
      `/api/v1/workspaces/${workspaceId}/datasets/${datasetId}/retry`,
      { method: 'POST' }
    );
    setRetryingId(null);
    if (res.error) {
      setActionMessage(`Error retrying dataset: ${res.error}`);
    } else {
      setActionMessage('Dataset re-queued for processing.');
      await fetchDatasets();
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddLoading(true);
    setActionMessage(null);
    const res = await apiRequest(`/api/v1/workspaces/${workspaceId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email: newMemberEmail, role: newMemberRole }),
    });
    setAddLoading(false);
    if (res.error) {
      setActionMessage(`Error: ${res.error}`);
      return;
    }
    setShowAddModal(false);
    setNewMemberEmail('');
    setActionMessage('Member added successfully.');
    fetchMembers();
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    setActionMessage(null);
    const res = await apiRequest(`/api/v1/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: newRole }),
    });
    if (res.error) {
      setActionMessage(`Error: ${res.error}`);
      return;
    }
    setActionMessage('Member role updated.');
    fetchMembers();
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this member from the workspace?')) {
      return;
    }
    setActionMessage(null);
    const res = await apiRequest(`/api/v1/workspaces/${workspaceId}/members/${userId}`, {
      method: 'DELETE',
    });
    if (res.error) {
      setActionMessage(`Error: ${res.error}`);
      return;
    }
    setActionMessage('Member removed.');
    fetchMembers();
  };

  // Integration Handlers
  const handleCreateIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIntegrationName.trim()) return;

    setCreatingIntegration(true);
    setActionMessage(null);

    const res = await createIntegration(workspaceId, {
      name: newIntegrationName.trim(),
      integrationType: 'linux_auth',
      metadata: { environment: newIntegrationEnv },
    });

    setCreatingIntegration(false);

    if (res.data) {
      setNewIntegrationName('');
      setShowAddIntegrationModal(false);
      setActionMessage('Linux authentication integration registered successfully.');
      await fetchIntegrationsList();
      setSelectedIntegrationId(res.data.integration.id);
    } else if (res.error) {
      setActionMessage(`Failed to create integration: ${res.error}`);
    }
  };

  const handleInitiateEnrollment = async (intId: string) => {
    setInitiatingEnrollment(true);
    setActionMessage(null);

    const res = await initiateEnrollment(workspaceId, intId);
    setInitiatingEnrollment(false);

    if (res.data) {
      setActiveEnrollmentToken({
        token: res.data.enrollment.enrollmentToken,
        expiresAt: res.data.enrollment.expiresAt,
        warning: res.data.enrollment.warning,
      });
      setActionMessage('Single-use enrollment token generated. Copy it now; it will not be displayed again.');
      await fetchIntegrationDetailData(intId);
    } else if (res.error) {
      setActionMessage(`Enrollment error: ${res.error}`);
    }
  };

  const handleRevokeIntegration = async (intId: string) => {
    if (!confirm('Are you sure you want to revoke this integration? Any active enrollment tokens and agent credentials will be permanently invalidated immediately.')) {
      return;
    }

    setRevokingIntegration(true);
    setActionMessage(null);

    const res = await revokeIntegration(workspaceId, intId);
    setRevokingIntegration(false);

    if (res.data) {
      setActiveEnrollmentToken(null);
      setActionMessage('Integration credentials and enrollment tokens successfully revoked.');
      await fetchIntegrationDetailData(intId);
      fetchIntegrationsList();
    } else if (res.error) {
      setActionMessage(`Revocation error: ${res.error}`);
    }
  };

  const handleCopyEnrollmentToken = (token: string) => {
    if (!token) return;
    navigator.clipboard.writeText(token);
    setCopiedEnrollmentToken(true);
    setTimeout(() => setCopiedEnrollmentToken(false), 2000);
  };

  // Notification Preferences Handlers
  const handleSaveNotificationSettings = async () => {
    if (!notificationSettings) return;
    setNotificationsSaving(true);
    setActionMessage(null);
    const res = await updateNotificationSettings(workspaceId, {
      enabled: notificationSettings.enabled,
      minSeverity: notificationSettings.minSeverity,
      notifyEmails: notificationSettings.notifyEmails,
      includeEvidenceSummary: notificationSettings.includeEvidenceSummary,
    });
    setNotificationsSaving(false);
    if (res.data) {
      setNotificationSettings(res.data.settings);
      setActionMessage('Alert notification preferences saved successfully.');
    } else if (res.error) {
      setActionMessage(`Error saving preferences: ${res.error}`);
    }
  };

  const handleAddRecipientEmail = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newEmailInput.trim().toLowerCase();
    if (!trimmed || !notificationSettings) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setActionMessage('Please enter a valid email address.');
      return;
    }
    if (notificationSettings.notifyEmails.includes(trimmed)) {
      setActionMessage('Email address is already in recipient list.');
      return;
    }
    setNotificationSettings({
      ...notificationSettings,
      notifyEmails: [...notificationSettings.notifyEmails, trimmed],
    });
    setNewEmailInput('');
  };

  const handleRemoveRecipientEmail = (emailToRemove: string) => {
    if (!notificationSettings) return;
    setNotificationSettings({
      ...notificationSettings,
      notifyEmails: notificationSettings.notifyEmails.filter((e) => e !== emailToRemove),
    });
  };

  const handleSendTestNotification = async () => {
    if (!notificationSettings || notificationSettings.notifyEmails.length === 0) {
      setActionMessage('Please add at least one recipient email before sending a test notification.');
      return;
    }
    const targetEmail = notificationSettings.notifyEmails[0];
    setTestEmailLoading(true);
    setActionMessage(null);
    const res = await sendTestNotification(workspaceId, targetEmail);
    setTestEmailLoading(false);
    if (res.data) {
      setActionMessage(`Test alert email dispatched to ${targetEmail}.`);
      fetchNotificationData();
    } else if (res.error) {
      setActionMessage(`Test email failed: ${res.error}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
        <div className="flex items-center gap-3 text-xs">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
          Loading security investigation console...
        </div>
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 p-6 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-rose-400" />
        <h2 className="text-lg font-bold text-white">Workspace Access Denied</h2>
        <p className="text-xs text-slate-400 max-w-md">{error}</p>
        <Link
          href="/workspaces"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 text-xs font-medium text-slate-200 hover:bg-slate-700"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Workspaces
        </Link>
      </div>
    );
  }

  const isManager = workspace.myRole === 'owner' || workspace.myRole === 'admin';
  const isAnalyst = isManager || workspace.myRole === 'analyst';

  // Compute posture for overview
  const criticalCount = dashboardData?.metrics?.alerts?.bySeverity?.critical || 0;
  const highCount = dashboardData?.metrics?.alerts?.bySeverity?.high || 0;
  const mediumCount = dashboardData?.metrics?.alerts?.bySeverity?.medium || 0;
  const openAlertsCount = dashboardData?.metrics?.alerts?.byStatus?.open || 0;
  const openCasesCount = (dashboardData?.metrics?.cases?.byStatus?.open || 0) + (dashboardData?.metrics?.cases?.byStatus?.in_progress || 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <header className="space-y-4 pb-4 border-b border-slate-800/80">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <Link
                href="/workspaces"
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Workspaces Directory
              </Link>
              {workspace.organization && (
                <>
                  <span className="text-slate-600 text-xs">•</span>
                  <Link
                    href={`/organizations/${workspace.organization.id}`}
                    className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors font-medium"
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    {workspace.organization.name} (MSP Console)
                    <ArrowUpRight className="w-3 h-3" />
                  </Link>
                </>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              {siblingClients.length > 1 && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-500 text-[11px]">Client:</span>
                  <select
                    value={workspace.id}
                    onChange={(e) => {
                      if (e.target.value !== workspace.id) {
                        router.push(`/workspaces/${e.target.value}`);
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                  >
                    {siblingClients.map((sc) => (
                      <option key={sc.id} value={sc.id}>
                        {sc.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
                workspace.myRole === 'owner' ? 'bg-purple-950 text-purple-300 border border-purple-800/60' :
                workspace.myRole === 'admin' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60' :
                workspace.myRole === 'analyst' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' :
                'bg-slate-800 text-slate-300 border border-slate-700'
              }`}>
                Role: {workspace.myRole}
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-cyan-950/60 border border-cyan-800/50 text-cyan-400">
                <Building className="w-7 h-7" />
              </div>
              <div>
                {workspace.organization && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 mb-1 rounded text-[10px] font-medium bg-cyan-950/60 border border-cyan-800/50 text-cyan-300">
                    Client of {workspace.organization.name}
                  </span>
                )}
                <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
                  {workspace.name}
                </h1>
                <p className="text-xs font-mono text-slate-400">Tenant UUID: {workspace.id}</p>
              </div>
            </div>

            {/* Quick Status / Posture Banner */}
            <div className="flex items-center gap-3">
              {criticalCount > 0 || highCount > 0 ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs font-medium">
                  <AlertCircle className="w-4 h-4 text-rose-400 animate-pulse" />
                  <span>{criticalCount + highCount} High/Critical Detections</span>
                </div>
              ) : mediumCount > 0 ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-950/80 border border-amber-800 text-amber-300 text-xs font-medium">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>{mediumCount} Suspicious Activities</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs font-medium">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Security State Nominal</span>
                </div>
              )}
            </div>
          </div>

          {/* Action notification */}
          {actionMessage && (
            <div className={`p-3 rounded-xl text-xs flex items-center justify-between gap-2 ${
              actionMessage.startsWith('Error') || actionMessage.startsWith('Failed')
                ? 'bg-rose-950/60 border border-rose-800 text-rose-200'
                : 'bg-emerald-950/60 border border-emerald-800 text-emerald-200'
            }`}>
              <div className="flex items-center gap-2">
                {actionMessage.startsWith('Error') || actionMessage.startsWith('Failed') ? (
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                )}
                <span>{actionMessage}</span>
              </div>
              <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Active Navigation Tabs */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/40">
            <button
              onClick={() => {
                setActiveTab('overview');
                setSelectedCaseId(null);
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'overview'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Overview
            </button>
            <button
              onClick={() => {
                setActiveTab('alerts');
                setSelectedCaseId(null);
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'alerts'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              Security Alerts ({dashboardData?.metrics?.alerts?.total ?? alerts.length})
            </button>
            <button
              onClick={() => {
                setActiveTab('cases');
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'cases'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <Briefcase className="w-4 h-4" />
              Investigation Cases ({dashboardData?.metrics?.cases?.total ?? casesTotal})
            </button>
            <button
              onClick={() => {
                setActiveTab('events');
                setSelectedCaseId(null);
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'events'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <Activity className="w-4 h-4" />
              Events Explorer ({dashboardData?.metrics?.events?.total ?? eventsTotal})
            </button>
            <button
              onClick={() => {
                setActiveTab('datasets');
                setSelectedCaseId(null);
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'datasets'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <Layers className="w-4 h-4" />
              Datasets & Logs ({datasets.length})
            </button>
            <button
              onClick={() => {
                setActiveTab('integrations');
                setSelectedCaseId(null);
                setSelectedIntegrationId(null);
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'integrations'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <Server className="w-4 h-4" />
              Integrations ({integrations.length})
            </button>
            <button
              onClick={() => {
                setActiveTab('notifications');
                setSelectedCaseId(null);
                setSelectedIntegrationId(null);
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'notifications'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <Bell className="w-4 h-4" />
              Notifications
            </button>
            <button
              onClick={() => {
                setActiveTab('members');
                setSelectedCaseId(null);
                setSelectedIntegrationId(null);
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'members'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/60 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <Users className="w-4 h-4" />
              Team Members ({members.length})
            </button>
            <Link
              href={`/billing?workspaceId=${workspaceId}`}
              className="px-3.5 py-2 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 text-slate-400 hover:text-white hover:bg-slate-900/40"
              title="Workspace subscription plan, quotas, and invoices"
            >
              <CreditCard className="w-4 h-4 text-cyan-400" />
              Billing
            </Link>
            <Link
              href={`/webhooks?workspaceId=${workspaceId}`}
              className="px-3.5 py-2 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 text-slate-400 hover:text-white hover:bg-slate-900/40"
              title="Outbound alert webhooks & SIEM integrations"
            >
              <Zap className="w-4 h-4 text-amber-400" />
              Webhooks
            </Link>
          </div>
        </header>

        {/* Global Investigation Navigation Banner (if navigating from an alert) */}
        {investigationContext && activeTab === 'events' && (
          <div className="p-3.5 rounded-2xl bg-cyan-950/70 border border-cyan-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <span className="p-1 rounded-lg bg-cyan-900/60 text-cyan-300 border border-cyan-700/60">
                <ShieldAlert className="w-4 h-4" />
              </span>
              <div>
                <span className="text-cyan-200 font-medium">Viewing supporting evidence for: </span>
                <strong className="text-white">{investigationContext.alertTitle}</strong>{' '}
                <span className="font-mono text-[11px] text-cyan-300">({investigationContext.ruleId})</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleReturnToAlert}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Return to Alert
              </button>
              <button
                onClick={handleClearInvestigation}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                title="Dismiss banner"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 1: OVERVIEW DASHBOARD */}
        {/* ========================================================================= */}
        {activeTab === 'overview' && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white">Workspace Security Overview</h2>
                <p className="text-xs text-slate-400">
                  Aggregated telemetry, detection alert metrics, and recent workspace activity
                </p>
              </div>
              <button
                onClick={fetchDashboard}
                disabled={dashboardLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs transition-colors self-start sm:self-auto"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${dashboardLoading ? 'animate-spin' : ''}`} />
                Refresh Metrics
              </button>
            </div>

            {dashboardError && (
              <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{dashboardError}</span>
              </div>
            )}

            {/* KPI Metrics Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Total Alerts */}
              <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Detected Alerts</span>
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">
                    {dashboardData?.metrics?.alerts?.total ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                    <span className="text-rose-400 font-semibold">{openAlertsCount} Open</span>
                    <span>•</span>
                    <span className="text-amber-400">{dashboardData?.metrics?.alerts?.byStatus?.acknowledged ?? 0} In Progress</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 pt-2 border-t border-slate-800/60 text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 font-mono">
                    {criticalCount} crit
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-200 font-mono">
                    {highCount} high
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 font-mono">
                    {mediumCount} med
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                    {dashboardData?.metrics?.alerts?.bySeverity?.low ?? 0} low
                  </span>
                </div>
              </div>

              {/* Card 2: Investigation Cases */}
              <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Active Cases</span>
                  <Briefcase className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">
                    {dashboardData?.metrics?.cases?.total ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                    <span className="text-cyan-300 font-semibold">{openCasesCount} Active</span>
                    <span>•</span>
                    <span className="text-purple-300">{dashboardData?.metrics?.cases?.byStatus?.escalated ?? 0} Escalated</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 pt-2 border-t border-slate-800/60 text-[10px]">
                  <span className="text-slate-400 font-mono">
                    {dashboardData?.metrics?.cases?.byStatus?.closed ?? 0} Closed cases
                  </span>
                </div>
              </div>

              {/* Card 3: Security Events Ingested */}
              <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Normalized Events</span>
                  <Activity className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">
                    {dashboardData?.metrics?.events?.total ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Canonical events parsed & persisted
                  </div>
                </div>
                <div className="flex items-center gap-1.5 pt-2 border-t border-slate-800/60 text-[10px]">
                  <span className="text-slate-400 font-mono">
                    {dashboardData?.metrics?.events?.bySeverity?.high ?? 0} High events
                  </span>
                  <span>•</span>
                  <span className="text-slate-400 font-mono">
                    {dashboardData?.metrics?.events?.bySeverity?.medium ?? 0} Med events
                  </span>
                </div>
              </div>

              {/* Card 4: Ingestion Datasets */}
              <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Ingested Datasets</span>
                  <Layers className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">
                    {dashboardData?.metrics?.datasets?.total ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                    <span className="text-emerald-400">{dashboardData?.metrics?.datasets?.byStatus?.completed ?? 0} Completed</span>
                    {Boolean(dashboardData?.metrics?.datasets?.byStatus?.failed) && (
                      <span className="text-rose-400">• {dashboardData?.metrics?.datasets?.byStatus?.failed} Failed</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 pt-2 border-t border-slate-800/60 text-[10px]">
                  <span className="text-slate-400">
                    Queue: {dashboardData?.metrics?.datasets?.byStatus?.processing ?? 0} running, {dashboardData?.metrics?.datasets?.byStatus?.queued ?? 0} queued
                  </span>
                </div>
              </div>
            </div>

            {/* Recent Alerts & Recent Events Dual Column */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column: Recent Security Alerts */}
              <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-sm font-semibold text-white">Recent Security Detections</h3>
                  </div>
                  <button
                    onClick={() => setActiveTab('alerts')}
                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium"
                  >
                    View All <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>

                {(!dashboardData?.recentAlerts || dashboardData.recentAlerts.length === 0) ? (
                  <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl space-y-2">
                    <p className="text-xs text-slate-400">No detection alerts have been triggered yet.</p>
                    <p className="text-[11px] text-slate-500">Upload auth telemetry to run versioned correlation rules.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {dashboardData.recentAlerts.map((alt) => (
                      <div
                        key={alt.id}
                        className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-colors space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              alt.severity === 'high' || alt.severity === 'critical'
                                ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                : alt.severity === 'medium'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : 'bg-slate-800 text-slate-300'
                            }`}>
                              {alt.severity}
                            </span>
                            <span className="font-medium text-white text-xs truncate max-w-[220px]">
                              {alt.title}
                            </span>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] capitalize font-medium ${
                            alt.status === 'open'
                              ? 'bg-rose-950/60 text-rose-300 border border-rose-800/60'
                              : 'bg-slate-800 text-slate-400'
                          }`}>
                            {alt.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 line-clamp-1">{alt.summary}</p>
                        <div className="flex items-center justify-between pt-1 border-t border-slate-800/40 text-[10px] text-slate-500 font-mono">
                          <span>Rule: {alt.ruleId}</span>
                          <button
                            onClick={() => {
                              setSelectedAlertId(alt.id);
                              setActiveTab('alerts');
                            }}
                            className="text-cyan-400 hover:underline flex items-center gap-1 font-sans"
                          >
                            Investigate <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Right Column: Recent Telemetry Ingested */}
              <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-sm font-semibold text-white">Recent Security Telemetry</h3>
                  </div>
                  <button
                    onClick={() => setActiveTab('events')}
                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium"
                  >
                    Explore All <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>

                {(!dashboardData?.recentEvents || dashboardData.recentEvents.length === 0) ? (
                  <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl space-y-2">
                    <p className="text-xs text-slate-400">No telemetry events recorded yet.</p>
                    <p className="text-[11px] text-slate-500">Telemetry will stream here upon log ingestion.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {dashboardData.recentEvents.map((evt) => (
                      <div
                        key={evt.id}
                        className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-colors space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white">{evt.event_type}</span>
                            {evt.username && (
                              <span className="text-[11px] font-mono text-cyan-300">
                                {evt.username}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-slate-500">
                            {new Date(evt.occurred_at).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-slate-400 truncate">{evt.message}</p>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-1 border-t border-slate-800/40">
                          <span>Host: {evt.source_host || 'unknown'}</span>
                          <span>IP: {evt.source_ip || 'n/a'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: DETECTED SECURITY ALERTS & INVESTIGATION */}
        {/* ========================================================================= */}
        {activeTab === 'alerts' && (
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white">Security Detections & Alert Investigation</h2>
                <p className="text-xs text-slate-400">
                  Deterministic, versioned security detections backed by cryptographic event evidence
                </p>
              </div>

              <button
                onClick={fetchAlerts}
                disabled={alertsLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs transition-colors self-start sm:self-auto"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${alertsLoading ? 'animate-spin' : ''}`} />
                Refresh Alerts
              </button>
            </div>

            {/* Filter Bar */}
            <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                <div className="flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Filter Alerts</span>
                </div>
                {(alertStatusFilter !== 'all' || alertSeverityFilter !== 'all' || alertRuleFilter !== 'all' || alertFromFilter || alertToFilter) && (
                  <button
                    onClick={handleClearAlertFilters}
                    className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
                  >
                    Reset Filters
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                {/* Status Filter */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Status</label>
                  <select
                    value={alertStatusFilter}
                    onChange={(e) => setAlertStatusFilter(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                  >
                    <option value="all">All Statuses</option>
                    <option value="open">Open</option>
                    <option value="acknowledged">Acknowledged</option>
                    <option value="resolved">Resolved</option>
                    <option value="dismissed">Dismissed</option>
                  </select>
                </div>

                {/* Severity Filter */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Severity</label>
                  <select
                    value={alertSeverityFilter}
                    onChange={(e) => setAlertSeverityFilter(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                  >
                    <option value="all">All Severities</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="info">Info</option>
                  </select>
                </div>

                {/* Rule Filter */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Detection Rule</label>
                  <select
                    value={alertRuleFilter}
                    onChange={(e) => setAlertRuleFilter(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500 font-mono"
                  >
                    <option value="all">All Rules</option>
                    <option value="AUTH_REPEATED_FAILURES">AUTH_REPEATED_FAILURES</option>
                    <option value="AUTH_SUCCESS_AFTER_FAILURES">AUTH_SUCCESS_AFTER_FAILURES</option>
                    <option value="PRIV_ACCOUNT_ACTIVITY">PRIV_ACCOUNT_ACTIVITY</option>
                    <option value="AUTH_INVALID_USER_PROBING">AUTH_INVALID_USER_PROBING</option>
                  </select>
                </div>

                {/* Time Range Filter */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Created From</label>
                  <input
                    type="datetime-local"
                    value={alertFromFilter}
                    onChange={(e) => setAlertFromFilter(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>

            {alertsError && (
              <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{alertsError}</span>
              </div>
            )}

            {alerts.length === 0 ? (
              <div className="p-12 rounded-2xl border border-slate-800 bg-slate-900/30 text-center space-y-2">
                <ShieldAlert className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-300 font-medium">No matching security alerts found</p>
                <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                  Try clearing or relaxing your filters. When ingested logs match versioned correlation rules, evidence-backed alerts will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {alerts.map((alt) => (
                  <div
                    key={alt.id}
                    className={`p-4 rounded-2xl border transition-colors space-y-3 ${
                      selectedAlertId === alt.id
                        ? 'border-cyan-500/80 bg-slate-900/80 ring-1 ring-cyan-500/30'
                        : 'border-slate-800 bg-slate-900/40 hover:bg-slate-900/60'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          alt.severity === 'high' || alt.severity === 'critical'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : alt.severity === 'medium'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}>
                          {alt.severity}
                        </span>
                        <span className="font-semibold text-white text-xs">{alt.title}</span>
                        <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800/60">
                          {alt.ruleId} v{alt.ruleVersion}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${
                          alt.status === 'open'
                            ? 'bg-rose-950/60 text-rose-300 border border-rose-800/60'
                            : alt.status === 'acknowledged'
                            ? 'bg-amber-950/60 text-amber-300 border border-amber-800/60'
                            : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                        }`}>
                          {alt.status}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400">
                        First seen: {new Date(alt.firstEventAt).toLocaleString()}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs text-slate-300">{alt.summary}</p>
                      <div className="text-[11px] font-mono text-slate-400 bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/60">
                        <span className="text-slate-500 font-sans block text-[10px] font-semibold uppercase tracking-wider mb-1">
                          Factual Detection Logic
                        </span>
                        {alt.reason}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-800/40 text-[11px]">
                      <div className="flex flex-wrap items-center gap-3 font-mono text-slate-400">
                        <span>Supporting Events: <strong className="text-white">{alt.eventCount}</strong></span>
                        <span title={`Full Cryptographic Fingerprint: ${alt.fingerprint}`}>
                          FP: {alt.fingerprint.slice(0, 16)}...
                        </span>
                        {Boolean(alt.metadata?.has_uncertain_timestamps) && (
                          <span className="text-amber-400 font-sans text-[10px] bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-800/50">
                            ~ Inferred Year/TZ
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {/* 1-Click Create Investigation Case Button */}
                        {isAnalyst && (
                          <button
                            onClick={() => handleCreateCaseFromAlert(alt)}
                            disabled={creatingCaseForAlertId === alt.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow transition-colors disabled:opacity-50"
                          >
                            {creatingCaseForAlertId === alt.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Briefcase className="w-3.5 h-3.5" />
                            )}
                            Create Case
                          </button>
                        )}

                        {isAnalyst && alt.status === 'open' && (
                          <button
                            onClick={() => handleUpdateAlertStatus(alt.id, 'acknowledged')}
                            disabled={updatingAlertId === alt.id}
                            className="px-2.5 py-1 rounded-lg bg-amber-950/60 hover:bg-amber-900/60 text-amber-200 border border-amber-800/60 text-[10px] transition-colors"
                          >
                            Acknowledge
                          </button>
                        )}
                        {isAnalyst && alt.status !== 'resolved' && (
                          <button
                            onClick={() => handleUpdateAlertStatus(alt.id, 'resolved')}
                            disabled={updatingAlertId === alt.id}
                            className="px-2.5 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-200 border border-emerald-800/60 text-[10px] transition-colors"
                          >
                            Resolve
                          </button>
                        )}
                        {isAnalyst && alt.status !== 'dismissed' && (
                          <button
                            onClick={() => handleUpdateAlertStatus(alt.id, 'dismissed')}
                            disabled={updatingAlertId === alt.id}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[10px] transition-colors"
                          >
                            Dismiss
                          </button>
                        )}

                        <button
                          onClick={() => handleToggleAlertEvidence(alt.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                        >
                          {loadingAlertId === alt.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : selectedAlertId === alt.id ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                          Evidence ({alt.eventCount})
                        </button>
                      </div>
                    </div>

                    {/* Expandable Evidence Drawer */}
                    {selectedAlertId === alt.id && alertDetails[alt.id] && (
                      <div className="pt-3 border-t border-slate-800/60 space-y-3">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                          <span>Linked Canonical Telemetry Events ({alertDetails[alt.id].evidenceEvents.length})</span>
                          <span className="text-[11px] font-normal text-slate-400">
                            Click any event to open and highlight in Events Explorer
                          </span>
                        </div>

                        <div className="space-y-2">
                          {alertDetails[alt.id].evidenceEvents.map((ev, evIdx) => (
                            <div
                              key={ev.eventId || evIdx}
                              className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 text-[11px] font-mono space-y-2 hover:border-slate-700 transition-colors"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold ${
                                    ev.role === 'trigger'
                                      ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                      : 'bg-purple-950 text-purple-300 border border-purple-800/60'
                                  }`}>
                                    {ev.role}
                                  </span>
                                  <span className="text-white font-semibold">{ev.eventType}</span>
                                  {ev.username && <span className="text-cyan-300">user: {ev.username}</span>}
                                  {ev.sourceIp && <span className="text-slate-400">from {ev.sourceIp}</span>}
                                  {ev.sourceHost && <span className="text-slate-400">host: {ev.sourceHost}</span>}
                                </div>
                                <span className="text-slate-500">{new Date(ev.occurredAt).toUTCString()}</span>
                              </div>

                              <p className="text-slate-300 truncate bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
                                {ev.message}
                              </p>

                              <div className="flex items-center justify-between pt-1 text-[10px]">
                                <span className="text-slate-500">Event ID: {ev.eventId}</span>
                                <button
                                  onClick={() => handleJumpToEventInvestigation(alt, ev.eventId)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-800/60 font-sans transition-colors"
                                >
                                  Investigate in Events Explorer <ArrowRight className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: INVESTIGATION CASES & CASE DETAIL */}
        {/* ========================================================================= */}
        {activeTab === 'cases' && (
          <section className="space-y-4">
            {/* If Single Case is Selected: Case Detail View */}
            {selectedCaseId && selectedCaseDetail ? (
              <div className="space-y-5 animate-in fade-in">
                {/* Back bar */}
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => {
                      setSelectedCaseId(null);
                      setSelectedCaseDetail(null);
                      fetchCases();
                    }}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 transition-colors font-medium"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to Cases List
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleExportCaseReport(selectedCaseDetail.id)}
                      disabled={exportingReport}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-cyan-300 text-xs font-medium transition-colors"
                    >
                      {exportingReport ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      Export Investigation Report (JSON)
                    </button>
                    {isAnalyst && (
                      <button
                        onClick={() => setShowLinkAlertModal(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs transition-colors"
                      >
                        <LinkIcon className="w-3.5 h-3.5" />
                        Link Alert
                      </button>
                    )}
                  </div>
                </div>

                {/* Case Header Card */}
                <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/50 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-lg font-bold text-white">{selectedCaseDetail.title}</h2>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          selectedCaseDetail.priority === 'critical' || selectedCaseDetail.priority === 'high'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : selectedCaseDetail.priority === 'medium'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-slate-800 text-slate-300'
                        }`}>
                          {selectedCaseDetail.priority}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 font-mono">Case ID: {selectedCaseDetail.id}</p>
                    </div>

                    {/* Status & Assignee Controls */}
                    <div className="flex flex-wrap items-center gap-2.5">
                      {/* Status Selector */}
                      <div className="space-y-0.5">
                        <label className="text-[10px] text-slate-500 block uppercase font-semibold">Status</label>
                        {isAnalyst ? (
                          <select
                            value={selectedCaseDetail.status}
                            disabled={updatingCaseStatus}
                            onChange={(e) => handleUpdateCaseStatus(selectedCaseDetail.id, e.target.value)}
                            className="px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500 capitalize"
                          >
                            <option value="open">Open</option>
                            <option value="in_progress">In Progress</option>
                            <option value="escalated">Escalated</option>
                            <option value="closed">Closed</option>
                          </select>
                        ) : (
                          <span className="px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs capitalize">
                            {selectedCaseDetail.status.replace('_', ' ')}
                          </span>
                        )}
                      </div>

                      {/* Assignee Selector */}
                      <div className="space-y-0.5">
                        <label className="text-[10px] text-slate-500 block uppercase font-semibold">Assignee</label>
                        {isAnalyst ? (
                          <select
                            value={selectedCaseDetail.assigneeId || ''}
                            disabled={updatingCaseAssignee}
                            onChange={(e) => handleUpdateCaseAssignee(selectedCaseDetail.id, e.target.value || null)}
                            className="px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                          >
                            <option value="">Unassigned</option>
                            {members.map((m) => (
                              <option key={m.user_id} value={m.user_id}>
                                {m.full_name || m.email} ({m.role})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs">
                            {selectedCaseDetail.assignee ? (selectedCaseDetail.assignee.fullName || selectedCaseDetail.assignee.email) : 'Unassigned'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {selectedCaseDetail.description && (
                    <div className="text-xs text-slate-300 whitespace-pre-wrap bg-slate-950/60 p-3 rounded-xl border border-slate-800/60">
                      {selectedCaseDetail.description}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-800/40 font-mono">
                    <div>
                      Created by <span className="text-slate-300">{selectedCaseDetail.createdBy.fullName || selectedCaseDetail.createdBy.email}</span> on {new Date(selectedCaseDetail.createdAt).toLocaleString()}
                    </div>
                    {selectedCaseDetail.closedAt && (
                      <div>Closed on {new Date(selectedCaseDetail.closedAt).toLocaleString()}</div>
                    )}
                  </div>
                </div>

                {/* AI Investigation Assistant Panel */}
                <div className="p-5 rounded-2xl border border-indigo-500/30 bg-gradient-to-b from-indigo-950/20 via-slate-900/60 to-slate-900/40 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                        <Bot className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-white tracking-wide">
                            AI Investigation Assistant
                          </h3>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase bg-indigo-950/80 text-indigo-300 border border-indigo-700/50">
                            Advisory & Grounded
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">
                          Evidence-grounded hypothesis generation, citation verification, and analysis.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTriggerAiInvestigation(selectedCaseDetail.id)}
                        disabled={loadingAiInvestigation || !isAnalyst}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-sm transition-all ${
                          isAnalyst && !loadingAiInvestigation
                            ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                        title={!isAnalyst ? 'Analyst role or higher required to run AI assistant' : 'Analyze evidence with AI'}
                      >
                        {loadingAiInvestigation ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Synthesizing Evidence...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                            <span>{aiInvestigation ? 'Re-run Analysis' : 'Run AI Investigation'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Error State */}
                  {aiInvestigationError && (
                    <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-800/80 text-xs text-rose-200 flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-semibold">AI Investigation Failed</div>
                          <div className="text-rose-300 mt-0.5">{aiInvestigationError}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleTriggerAiInvestigation(selectedCaseDetail.id)}
                        className="px-2.5 py-1 rounded-lg bg-rose-900/60 hover:bg-rose-800 text-[11px] font-semibold text-white border border-rose-700/60 transition-colors"
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  {/* Loading State */}
                  {loadingAiInvestigation && (
                    <div className="p-6 rounded-xl border border-indigo-900/40 bg-slate-950/60 flex flex-col items-center justify-center text-center space-y-2.5 animate-pulse">
                      <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                      <div className="text-xs font-semibold text-slate-200">Retrieving Authorized Workspace Evidence...</div>
                      <div className="text-[11px] text-slate-400 max-w-md">
                        Redacting credentials, bounding context, querying provider adapter, and validating evidence citations against server records.
                      </div>
                    </div>
                  )}

                  {/* Empty State */}
                  {!aiInvestigation && !loadingAiInvestigation && !aiInvestigationError && (
                    <div className="p-6 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 text-center space-y-2">
                      <Bot className="w-8 h-8 text-slate-600 mx-auto" />
                      <div className="text-xs font-medium text-slate-300">No AI investigation has been conducted for this case yet.</div>
                      <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                        Click &ldquo;Run AI Investigation&rdquo; to analyze linked security alerts, examine canonical events, and synthesize advisory next steps.
                      </p>
                    </div>
                  )}

                  {/* Result View */}
                  {aiInvestigation && aiInvestigation.response_json && !loadingAiInvestigation && (
                    <div className="space-y-4">
                      {/* Advisory Notice */}
                      <div className="px-3 py-2 rounded-xl bg-indigo-950/40 border border-indigo-900/50 flex items-center gap-2 text-[11px] text-indigo-200">
                        <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
                        <span>
                          <strong>Advisory Analysis:</strong> Grounded in verified database evidence. Original alerts, notes, and detection rules remain authoritative.
                        </span>
                      </div>

                      {/* Executive Summary */}
                      <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
                        <div className="text-[11px] font-semibold text-indigo-300 uppercase tracking-wider">
                          Executive Assessment
                        </div>
                        <p className="text-xs text-slate-200 leading-relaxed">
                          {aiInvestigation.response_json.summary}
                        </p>
                      </div>

                      {/* Observed Facts */}
                      <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Observed Facts (Direct Evidence)</span>
                          </div>
                          <span className="text-[10px] text-slate-500">
                            {aiInvestigation.response_json.observed_facts.length} facts verified
                          </span>
                        </div>
                        <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                          {aiInvestigation.response_json.observed_facts.map((fact, idx) => (
                            <li key={idx} className="leading-snug">
                              {fact}
                            </li>
                          ))}
                        </ul>

                        {/* Validated Event Citations */}
                        {aiInvestigation.response_json.supporting_event_ids.length > 0 && (
                          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] uppercase font-semibold text-slate-500 mr-1">
                              Cited Events:
                            </span>
                            {aiInvestigation.response_json.supporting_event_ids.map((id) => (
                              <button
                                key={id}
                                onClick={() => handleJumpToEvent(id)}
                                className="px-2 py-0.5 rounded-md bg-cyan-950 hover:bg-cyan-900 text-cyan-300 hover:text-cyan-200 border border-cyan-800/60 font-mono text-[10px] transition-colors"
                                title={`Click to jump to event ${id}`}
                              >
                                #{id.slice(0, 8)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Hypotheses & Unknowns Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Hypotheses */}
                        <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                          <div className="text-[11px] font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Lightbulb className="w-3.5 h-3.5" />
                            <span>Hypotheses (Unconfirmed)</span>
                          </div>
                          <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                            {aiInvestigation.response_json.hypotheses.map((hyp, idx) => (
                              <li key={idx} className="leading-snug">
                                {hyp}
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* Unknowns */}
                        <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                          <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                            <HelpCircle className="w-3.5 h-3.5" />
                            <span>Unknowns & Gaps</span>
                          </div>
                          <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                            {aiInvestigation.response_json.unknowns.map((unk, idx) => (
                              <li key={idx} className="leading-snug">
                                {unk}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      {/* Suggested Next Checks (Read-Only) */}
                      <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                        <div className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider">
                          Suggested Investigation Checks (Read-Only Advisory)
                        </div>
                        <ul className="space-y-1.5 text-xs text-slate-300">
                          {aiInvestigation.response_json.suggested_checks.map((chk, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0 mt-1.5" />
                              <span className="leading-snug">{chk}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Client-Facing Summary Draft */}
                      <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                            Client-Facing Summary Draft
                          </div>
                          <button
                            onClick={() => handleCopyDraft(aiInvestigation.response_json!.client_summary_draft)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 border border-slate-700 transition-colors"
                          >
                            {copiedDraft ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy Draft</span>
                              </>
                            )}
                          </button>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 text-xs text-slate-300 leading-relaxed italic">
                          &ldquo;{aiInvestigation.response_json.client_summary_draft}&rdquo;
                        </div>
                      </div>

                      {/* Investigation Limitations */}
                      {aiInvestigation.response_json.limitations.length > 0 && (
                        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
                          <div className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">
                            Caveats & Ingestion Boundaries
                          </div>
                          <ul className="list-disc list-inside space-y-0.5">
                            {aiInvestigation.response_json.limitations.map((lim, idx) => (
                              <li key={idx}>{lim}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Provenance Metadata Footer */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800 text-[10px] font-mono text-slate-500">
                        <div className="flex items-center gap-3">
                          <span>Provider: <strong className="text-slate-400">{aiInvestigation.provider}</strong></span>
                          <span>Model: <strong className="text-slate-400">{aiInvestigation.model}</strong></span>
                          <span>Latency: <strong className="text-slate-400">{aiInvestigation.duration_ms}ms</strong></span>
                          <span>Tokens: <strong className="text-slate-400">{aiInvestigation.prompt_tokens + aiInvestigation.completion_tokens}</strong></span>
                        </div>
                        <div>Generated: {new Date(aiInvestigation.created_at).toLocaleString()}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Case Grid: Linked Alerts & Evidence (Left) vs Notes & Audit Log (Right) */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left Column: Linked Alerts & Supporting Evidence */}
                  <div className="space-y-4">
                    {/* Linked Alerts */}
                    <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShieldAlert className="w-4 h-4 text-cyan-400" />
                          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                            Linked Security Alerts ({selectedCaseDetail.linkedAlerts.length})
                          </h3>
                        </div>
                      </div>

                      {selectedCaseDetail.linkedAlerts.length === 0 ? (
                        <p className="text-xs text-slate-500">No alerts currently linked to this case.</p>
                      ) : (
                        <div className="space-y-2.5">
                          {selectedCaseDetail.linkedAlerts.map((alt) => (
                            <div
                              key={alt.id}
                              className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                    alt.severity === 'high' || alt.severity === 'critical'
                                      ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                      : 'bg-slate-800 text-slate-300'
                                  }`}>
                                    {alt.severity}
                                  </span>
                                  <span className="font-semibold text-white">{alt.title}</span>
                                </div>
                                <span className="text-[10px] font-mono text-cyan-300">{alt.ruleId}</span>
                              </div>
                              <p className="text-[11px] text-slate-400">{alt.summary}</p>
                              <p className="text-[10px] font-mono text-slate-500 bg-slate-900/50 p-1.5 rounded">
                                {alt.reason}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Supporting Evidence Events */}
                    <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-cyan-400" />
                          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                            Canonical Evidence Events ({selectedCaseDetail.supportingEvents.length})
                          </h3>
                        </div>
                      </div>

                      {selectedCaseDetail.supportingEvents.length === 0 ? (
                        <p className="text-xs text-slate-500">No canonical evidence attached.</p>
                      ) : (
                        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                          {selectedCaseDetail.supportingEvents.map((ev, idx) => {
                            const eventKey = ev.eventId || (ev as any).id || (ev as any).event_id || String(idx);
                            const isHighlighted = highlightedEventId === eventKey || (ev.eventId && highlightedEventId === ev.eventId);
                            return (
                              <div
                                key={eventKey}
                                id={`case-event-${eventKey}`}
                                className={`p-2.5 rounded-xl border text-[11px] font-mono space-y-1 transition-all duration-300 ${
                                  isHighlighted
                                    ? 'bg-cyan-950/90 border-cyan-400 ring-2 ring-cyan-400/50 shadow-lg shadow-cyan-950'
                                    : 'bg-slate-950/70 border-slate-800'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="px-1.5 py-0.2 rounded text-[10px] uppercase bg-cyan-950 text-cyan-300 border border-cyan-800/60 font-semibold">
                                      {ev.role}
                                    </span>
                                    <span className="text-white font-semibold">{ev.eventType}</span>
                                    {ev.username && <span className="text-cyan-300">{ev.username}</span>}
                                    {ev.sourceIp && <span className="text-slate-400">{ev.sourceIp}</span>}
                                  </div>
                                  <span className="text-slate-500">{new Date(ev.occurredAt).toUTCString()}</span>
                                </div>
                                <p className="text-slate-400 truncate">{ev.message}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Investigation Notes & Audit History */}
                  <div className="space-y-4">
                    {/* Analyst Notes */}
                    <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-cyan-400" />
                          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                            Analyst Findings & Notes ({selectedCaseDetail.notes.length})
                          </h3>
                        </div>
                      </div>

                      {/* Add Note Form */}
                      {isAnalyst && (
                        <form onSubmit={handleAddCaseNote} className="space-y-2">
                          <textarea
                            value={newNoteContent}
                            onChange={(e) => setNewNoteContent(e.target.value)}
                            maxLength={10000}
                            placeholder="Document investigation findings, containment steps, or hypothesis (max 10,000 characters)..."
                            rows={3}
                            className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                          />
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-500">
                              {newNoteContent.length} / 10,000 characters
                            </span>
                            <button
                              type="submit"
                              disabled={addingNote || !newNoteContent.trim()}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors disabled:opacity-40 text-xs shadow"
                            >
                              {addingNote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                              Record Note
                            </button>
                          </div>
                        </form>
                      )}

                      {/* Notes List */}
                      {selectedCaseDetail.notes.length === 0 ? (
                        <p className="text-xs text-slate-500 text-center py-4">No investigation notes recorded yet.</p>
                      ) : (
                        <div className="space-y-2.5 pt-2 border-t border-slate-800/40 max-h-[320px] overflow-y-auto pr-1">
                          {selectedCaseDetail.notes.map((n) => (
                            <div
                              key={n.id}
                              className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5"
                            >
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="font-semibold text-cyan-300">
                                  {n.author.fullName || n.author.email}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-slate-500">
                                    {new Date(n.createdAt).toLocaleString()}
                                  </span>
                                  {isAnalyst && (
                                    <button
                                      onClick={() => handleDeleteCaseNote(n.id)}
                                      disabled={deletingNoteId === n.id}
                                      className="text-slate-500 hover:text-rose-400 transition-colors"
                                      title="Delete note"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              <p className="text-xs text-slate-200 whitespace-pre-wrap">{n.content}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Audit History Timeline */}
                    <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-cyan-400" />
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                          Case Audit History ({selectedCaseDetail.auditHistory.length})
                        </h3>
                      </div>

                      <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1 text-[11px] font-mono">
                        {selectedCaseDetail.auditHistory.map((a) => (
                          <div
                            key={a.id}
                            className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-start justify-between gap-2"
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2 font-semibold">
                                <span className="text-cyan-300">{a.action}</span>
                                <span className="text-slate-500">by {a.actor.fullName || a.actor.email}</span>
                              </div>
                              {a.details && (
                                <p className="text-slate-400 text-[10px] break-all">
                                  {JSON.stringify(a.details)}
                                </p>
                              )}
                            </div>
                            <span className="text-slate-500 text-[10px] shrink-0">
                              {new Date(a.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Case Roster / List View */
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-white">Investigation Cases</h2>
                    <p className="text-xs text-slate-400">
                      Manage incident cases, document findings, assign analysts, and export investigation reports
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {isAnalyst && (
                      <button
                        onClick={() => setShowNewCaseModal(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        New Case
                      </button>
                    )}
                    <button
                      onClick={fetchCases}
                      disabled={casesLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${casesLoading ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>
                </div>

                {/* Filter Controls */}
                <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">Status</label>
                    <select
                      value={caseStatusFilter}
                      onChange={(e) => {
                        setCaseStatusFilter(e.target.value);
                        setCasesPage(1);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                    >
                      <option value="all">All Statuses</option>
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="escalated">Escalated</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">Priority</label>
                    <select
                      value={casePriorityFilter}
                      onChange={(e) => {
                        setCasePriorityFilter(e.target.value);
                        setCasesPage(1);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                    >
                      <option value="all">All Priorities</option>
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">Assignee</label>
                    <select
                      value={caseAssigneeFilter}
                      onChange={(e) => {
                        setCaseAssigneeFilter(e.target.value);
                        setCasesPage(1);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                    >
                      <option value="all">All Assignees</option>
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name || m.email}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {casesError && (
                  <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{casesError}</span>
                  </div>
                )}

                {/* Cases List */}
                {cases.length === 0 ? (
                  <div className="p-12 rounded-2xl border border-slate-800 bg-slate-900/30 text-center space-y-2">
                    <Briefcase className="w-8 h-8 text-slate-600 mx-auto" />
                    <p className="text-xs text-slate-300 font-medium">No investigation cases found</p>
                    <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                      Create an investigation case directly or turn detected security alerts into cases.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {cases.map((c) => (
                      <div
                        key={c.id}
                        className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 hover:bg-slate-900/70 transition-colors space-y-2.5 cursor-pointer"
                        onClick={() => {
                          setSelectedCaseId(c.id);
                          fetchCaseDetail(c.id);
                        }}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              c.priority === 'critical' || c.priority === 'high'
                                ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                : c.priority === 'medium'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : 'bg-slate-800 text-slate-300'
                            }`}>
                              {c.priority}
                            </span>
                            <span className="font-semibold text-white text-xs">{c.title}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${
                              c.status === 'open'
                                ? 'bg-rose-950/60 text-rose-300 border border-rose-800/60'
                                : c.status === 'in_progress'
                                ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-800/60'
                                : c.status === 'escalated'
                                ? 'bg-purple-950/60 text-purple-300 border border-purple-800/60'
                                : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                            }`}>
                              {c.status.replace('_', ' ')}
                            </span>
                          </div>

                          <div className="text-[11px] font-mono text-slate-400">
                            Created: {new Date(c.createdAt).toLocaleDateString()}
                          </div>
                        </div>

                        {c.description && (
                          <p className="text-xs text-slate-400 line-clamp-1">{c.description}</p>
                        )}

                        <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-800/40 font-mono">
                          <div className="flex items-center gap-3">
                            <span>Assignee: <strong className="text-slate-300 font-sans">{c.assignee ? (c.assignee.fullName || c.assignee.email) : 'Unassigned'}</strong></span>
                            <span>Alerts: <strong className="text-white">{c.alertCount}</strong></span>
                            <span>Notes: <strong className="text-white">{c.noteCount}</strong></span>
                          </div>

                          <div className="flex items-center gap-1.5 text-cyan-400 font-sans">
                            <span>Open Details</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: PAGINATED SECURITY EVENTS EXPLORER */}
        {/* ========================================================================= */}
        {activeTab === 'events' && (
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white">Security Events Explorer</h2>
                <p className="text-xs text-slate-400">
                  Search, inspect, and analyze canonical normalized authentication events
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={fetchEvents}
                  disabled={eventsLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${eventsLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>

            {/* Explorer Search & Multi-field Filter Controls */}
            <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3">
              {/* Free-text Search Bar */}
              <form onSubmit={handleExecuteEventSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={eventSearchInput}
                    onChange={(e) => setEventSearchInput(e.target.value)}
                    placeholder="Search by username, source host, source IP, or message substring..."
                    className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 placeholder:text-slate-600 text-xs focus:outline-none focus:border-cyan-500 font-mono"
                  />
                  {eventSearchInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setEventSearchInput('');
                        setEventSearchQuery('');
                        setEventsPage(1);
                      }}
                      className="absolute right-3 top-2.5 text-slate-500 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow transition-colors shrink-0"
                >
                  Search
                </button>
              </form>

              {/* Advanced Field Filters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs pt-1 border-t border-slate-800/40">
                {/* Severity */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Severity</label>
                  <select
                    value={eventSeverityFilter}
                    onChange={(e) => {
                      setEventSeverityFilter(e.target.value);
                      setEventsPage(1);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                  >
                    <option value="all">All Severities</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="info">Info</option>
                  </select>
                </div>

                {/* Event Type */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Event Type</label>
                  <select
                    value={eventTypeFilter}
                    onChange={(e) => {
                      setEventTypeFilter(e.target.value);
                      setEventsPage(1);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500 font-mono"
                  >
                    <option value="all">All Event Types</option>
                    <option value="ssh_login_success">ssh_login_success</option>
                    <option value="ssh_login_failure">ssh_login_failure</option>
                    <option value="user_auth_failed">user_auth_failed</option>
                    <option value="sudo_command">sudo_command</option>
                    <option value="privilege_escalation">privilege_escalation</option>
                    <option value="invalid_user_probe">invalid_user_probe</option>
                    <option value="system_reboot">system_reboot</option>
                  </select>
                </div>

                {/* From Date */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Occurred From</label>
                  <input
                    type="datetime-local"
                    value={eventFromFilter}
                    onChange={(e) => {
                      setEventFromFilter(e.target.value);
                      setEventsPage(1);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>

                {/* To Date */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Occurred To</label>
                  <input
                    type="datetime-local"
                    value={eventToFilter}
                    onChange={(e) => {
                      setEventToFilter(e.target.value);
                      setEventsPage(1);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>

            {/* Pagination Controls Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-400">
              <div>
                Showing <strong className="text-white">{events.length === 0 ? 0 : (eventsPage - 1) * eventsLimit + 1}</strong> to{' '}
                <strong className="text-white">{Math.min(eventsPage * eventsLimit, eventsTotal)}</strong> of{' '}
                <strong className="text-white">{eventsTotal}</strong> canonical events
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-slate-500">Per page:</span>
                  <select
                    value={eventsLimit}
                    onChange={(e) => {
                      setEventsLimit(parseInt(e.target.value, 10));
                      setEventsPage(1);
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEventsPage((p) => Math.max(p - 1, 1))}
                    disabled={eventsPage <= 1 || eventsLoading}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 transition-colors text-xs"
                  >
                    Previous
                  </button>
                  <span className="px-2 font-mono text-[11px] text-slate-400">
                    Page {eventsPage} of {eventsTotalPages}
                  </span>
                  <button
                    onClick={() => setEventsPage((p) => Math.min(p + 1, eventsTotalPages))}
                    disabled={eventsPage >= eventsTotalPages || eventsLoading}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 transition-colors text-xs"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>

            {/* Events Roster */}
            <div className="space-y-2.5">
              {events.map((evt) => {
                const isHighlighted = investigationContext?.eventId === evt.id;
                const isExpanded = expandedEventId === evt.id;

                return (
                  <div
                    key={evt.id}
                    className={`p-3.5 rounded-2xl border transition-all space-y-2.5 ${
                      isHighlighted
                        ? 'border-cyan-400/90 bg-cyan-950/30 ring-2 ring-cyan-500/40 shadow-lg'
                        : 'border-slate-800 bg-slate-900/50 hover:bg-slate-900/70'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {isHighlighted && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-cyan-500 text-slate-950">
                              Target Evidence Event
                            </span>
                          )}
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            evt.severity === 'high' || evt.severity === 'critical'
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : evt.severity === 'medium'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-slate-800 text-slate-300'
                          }`}>
                            {evt.severity}
                          </span>
                          <span className="font-semibold text-white text-xs">{evt.event_type}</span>
                          {evt.source_host && (
                            <span className="font-mono text-[11px] text-slate-300 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">
                              host: {evt.source_host}
                            </span>
                          )}
                          {evt.username && (
                            <span className="font-mono text-[11px] text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/60">
                              user: {evt.username}
                            </span>
                          )}
                          {evt.source_ip && (
                            <span className="font-mono text-[11px] text-slate-400">
                              from {evt.source_ip}{evt.source_port ? `:${evt.source_port}` : ''}
                            </span>
                          )}
                          {evt.process_name && (
                            <span className="font-mono text-[11px] text-slate-500">
                              [{evt.process_name}{evt.evidence?.process_id ? `[${evt.evidence.process_id}]` : ''}]
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono text-slate-400">
                            {new Date(evt.occurred_at).toUTCString()}
                          </span>
                          <button
                            onClick={() => setExpandedEventId(isExpanded ? null : evt.id)}
                            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                          >
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <p className="text-slate-300 text-xs font-mono bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60 break-all">
                        {evt.message}
                      </p>
                    </div>

                    {isExpanded && (
                      <div className="pt-2 border-t border-slate-800/60 space-y-2 text-[11px]">
                        {evt.evidence?.raw_line && (
                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-500 uppercase font-semibold">Raw Syslog Record</span>
                            <pre className="p-2 rounded-xl bg-slate-950 text-slate-300 border border-slate-800 text-[11px] font-mono overflow-x-auto">
                              {evt.evidence.raw_line}
                            </pre>
                          </div>
                        )}
                        {evt.evidence && (
                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-500 uppercase font-semibold">Structured Evidence Payload</span>
                            <pre className="p-2.5 rounded-xl bg-slate-950 text-cyan-300/90 border border-slate-800 text-[11px] font-mono overflow-x-auto">
                              {JSON.stringify(evt.evidence, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: LOG INGESTION & DATASETS */}
        {/* ========================================================================= */}
        {activeTab === 'datasets' && (
          <section className="space-y-6">
            <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-white">Upload Linux Authentication Logs</h2>
                  <p className="text-xs text-slate-400">
                    Supports plain-text <code className="text-cyan-300">.log</code> and <code className="text-cyan-300">.txt</code> authentication telemetry.
                  </p>
                </div>
                <div className="text-[11px] font-mono text-slate-400 bg-slate-950/60 px-3 py-1.5 rounded-xl border border-slate-800">
                  Max: 5 MiB | 50,000 Lines
                </div>
              </div>

              {workspace.myRole === 'viewer' ? (
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-400 text-xs flex items-center gap-2.5">
                  <Lock className="w-4 h-4 text-slate-500" />
                  <span>Viewers have read-only access. Uploading new telemetry requires Analyst, Admin, or Owner permissions.</span>
                </div>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
                    dragOver
                      ? 'border-cyan-500 bg-cyan-950/20'
                      : 'border-slate-800 hover:border-slate-700 bg-slate-950/30'
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".log,.txt,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                  />

                  <div className="flex flex-col items-center justify-center space-y-3">
                    <div className="p-3.5 rounded-2xl bg-cyan-950/50 text-cyan-400 border border-cyan-800/40">
                      {uploadLoading ? (
                        <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                      ) : (
                        <UploadCloud className="w-6 h-6 text-cyan-400" />
                      )}
                    </div>
                    <p className="text-xs font-medium text-white">
                      {uploadLoading ? 'Uploading & queuing telemetry...' : 'Click to select or drag and drop a log file'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Datasets Roster */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Uploaded Datasets</h3>
                  <p className="text-xs text-slate-400">Durable storage and parsing jobs in PostgreSQL queue</p>
                </div>
                <button
                  onClick={fetchDatasets}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh
                </button>
              </div>

              <div className="space-y-3">
                {datasets.map((d) => (
                  <div
                    key={d.id}
                    className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 hover:bg-slate-900/60 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="font-semibold text-white text-xs truncate">{d.originalFilename}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${
                          d.status === 'completed' ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60' : 'bg-slate-800 text-slate-300'
                        }`}>
                          {d.status}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <a
                        href={`/api/v1/workspaces/${workspaceId}/datasets/${d.id}/raw`}
                        download={d.originalFilename}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Raw Log
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 6: WORKSPACE MEMBERS & RBAC */}
        {/* ========================================================================= */}
        {activeTab === 'members' && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Workspace Members & Access Control</h2>
                <p className="text-xs text-slate-400">Server-side RBAC enforced for Owner, Admin, Analyst, and Viewer</p>
              </div>
              {isManager && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium shadow transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Member
                </button>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="p-3.5">User</th>
                    <th className="p-3.5">Workspace Role</th>
                    <th className="p-3.5">Joined Date</th>
                    {isManager && <th className="p-3.5 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {members.map((m) => (
                    <tr key={m.membership_id} className="hover:bg-slate-900/60 transition-colors">
                      <td className="p-3.5">
                        <div className="font-medium text-white">{m.full_name || 'Unnamed Analyst'}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{m.email}</div>
                      </td>
                      <td className="p-3.5">
                        {isManager ? (
                          <select
                            value={m.role}
                            onChange={(e) => handleUpdateRole(m.user_id, e.target.value)}
                            disabled={workspace.myRole === 'admin' && m.role === 'owner'}
                            className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                          >
                            <option value="owner" disabled={workspace.myRole !== 'owner'}>Owner</option>
                            <option value="admin">Admin</option>
                            <option value="analyst">Analyst</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        ) : (
                          <span className="font-medium text-slate-300 uppercase text-[11px]">{m.role}</span>
                        )}
                      </td>
                      <td className="p-3.5 text-slate-400 text-[11px]">
                        {new Date(m.joined_at).toLocaleDateString()}
                      </td>
                      {isManager && (
                        <td className="p-3.5 text-right">
                          <button
                            onClick={() => handleRemoveMember(m.user_id)}
                            disabled={workspace.myRole === 'admin' && m.role === 'owner'}
                            className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors rounded-lg hover:bg-slate-800 disabled:opacity-30"
                            title="Remove member"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Modal: New Custom Investigation Case */}
        {showNewCaseModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="w-full max-w-lg p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Create New Investigation Case</h3>
                <button
                  onClick={() => setShowNewCaseModal(false)}
                  className="text-slate-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateCustomCase} className="space-y-3.5 text-xs">
                <div className="space-y-1">
                  <label className="text-slate-300 font-medium">Case Title</label>
                  <input
                    type="text"
                    required
                    value={newCaseTitle}
                    onChange={(e) => setNewCaseTitle(e.target.value)}
                    placeholder="e.g. Investigation: Repeated root SSH attempts on bastion"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-300 font-medium">Initial Scope / Description</label>
                  <textarea
                    value={newCaseDescription}
                    onChange={(e) => setNewCaseDescription(e.target.value)}
                    placeholder="Document the incident context, target systems, and initial analyst assessment..."
                    rows={3}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-slate-300 font-medium">Priority</label>
                    <select
                      value={newCasePriority}
                      onChange={(e) => setNewCasePriority(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500"
                    >
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-slate-300 font-medium">Assign To</label>
                    <select
                      value={newCaseAssigneeId}
                      onChange={(e) => setNewCaseAssigneeId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500"
                    >
                      <option value="">Unassigned</option>
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name || m.email}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowNewCaseModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={newCaseLoading || !newCaseTitle.trim()}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    {newCaseLoading ? 'Creating...' : 'Create Case'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Link Alert to Case */}
        {showLinkAlertModal && selectedCaseDetail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Link Alert to Case</h3>
                <button
                  onClick={() => setShowLinkAlertModal(false)}
                  className="text-slate-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleLinkAlertToCase} className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">Select Security Alert</label>
                  <select
                    value={linkAlertId}
                    onChange={(e) => setLinkAlertId(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">-- Choose an alert to associate --</option>
                    {alerts.map((alt) => (
                      <option key={alt.id} value={alt.id}>
                        [{alt.severity.toUpperCase()}] {alt.title} ({alt.ruleId})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowLinkAlertModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={linkingAlert || !linkAlertId}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    {linkingAlert ? 'Linking...' : 'Link Alert'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Add Workspace Member */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Add Workspace Member</h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-slate-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleAddMember} className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">User Email</label>
                  <input
                    type="email"
                    required
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    placeholder="analyst@corp.com"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">Assigned Role</label>
                  <select
                    value={newMemberRole}
                    onChange={(e) => setNewMemberRole(e.target.value as any)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="admin">Admin (Manage members & workspace settings)</option>
                    <option value="analyst">Analyst (Investigate & manage cases)</option>
                    <option value="viewer">Viewer (Read-only access)</option>
                  </select>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={addLoading}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    {addLoading ? 'Adding...' : 'Add Member'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* Integrations & Monitored Assets Tab Content               */}
        {/* ======================================================== */}
        {activeTab === 'integrations' && (
          <div className="space-y-6">
            {!selectedIntegrationId ? (
              // 1. Integrations List View
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                  <div>
                    <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Server className="w-4 h-4 text-cyan-400" />
                      Monitored Assets & Integrations
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Manage Linux authentication servers, live telemetry collectors, and secure agent enrollment credentials.
                    </p>
                  </div>
                  {isAnalyst && (
                    <button
                      onClick={() => setShowAddIntegrationModal(true)}
                      className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors flex items-center gap-2 shrink-0 shadow-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Add Integration
                    </button>
                  )}
                </div>

                {/* Fleet Health Summary Stat Cards */}
                {fleetHealthSummary && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between">
                      <div className="text-[11px] font-medium text-slate-400">Total Monitored</div>
                      <div className="text-xl font-bold text-white mt-1">{fleetHealthSummary.totalIntegrations}</div>
                      <div className="text-[10px] text-slate-500 mt-1">Linux Server Assets</div>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-emerald-900/40 flex flex-col justify-between">
                      <div className="text-[11px] font-medium text-emerald-400 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        Connected
                      </div>
                      <div className="text-xl font-bold text-emerald-300 mt-1">{fleetHealthSummary.connected}</div>
                      <div className="text-[10px] text-emerald-600 mt-1">Healthy Heartbeats</div>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-amber-900/40 flex flex-col justify-between">
                      <div className="text-[11px] font-medium text-amber-400">Degraded</div>
                      <div className="text-xl font-bold text-amber-300 mt-1">{fleetHealthSummary.degraded}</div>
                      <div className="text-[10px] text-amber-600 mt-1">Delayed Telemetry</div>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-rose-900/40 flex flex-col justify-between">
                      <div className="text-[11px] font-medium text-rose-400">Disconnected</div>
                      <div className="text-xl font-bold text-rose-300 mt-1">{fleetHealthSummary.disconnected}</div>
                      <div className="text-[10px] text-rose-600 mt-1">&gt;24h Offline</div>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-cyan-900/40 flex flex-col justify-between">
                      <div className="text-[11px] font-medium text-cyan-400 flex items-center gap-1">
                        <Activity className="w-3.5 h-3.5" />
                        24h Events
                      </div>
                      <div className="text-xl font-bold text-cyan-300 mt-1">{fleetHealthSummary.events24h.toLocaleString()}</div>
                      <div className="text-[10px] text-cyan-600 mt-1">Agent Ingestion</div>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-purple-900/40 flex flex-col justify-between">
                      <div className="text-[11px] font-medium text-purple-400 flex items-center gap-1">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Active Threats
                      </div>
                      <div className="text-xl font-bold text-purple-300 mt-1">{fleetHealthSummary.activeThreats}</div>
                      <div className="text-[10px] text-purple-600 mt-1">Open Alerts</div>
                    </div>
                  </div>
                )}

                {/* Info Callout */}
                <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-xs text-slate-300 flex items-start gap-3">
                  <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium text-slate-200">First Supported Integration: Linux Authentication Logs (<span className="font-mono text-cyan-300">linux_auth</span>)</p>
                    <p className="text-slate-400 leading-relaxed">
                      Register your Linux servers to issue secure, single-use enrollment tokens. Newly registered servers remain in a <strong className="text-amber-400">pending</strong> state until an authenticated agent establishes communication.
                    </p>
                  </div>
                </div>

                {/* Integrations Table / Cards */}
                {integrationsLoading ? (
                  <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs flex items-center justify-center gap-3">
                    <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                    Loading monitored integrations...
                  </div>
                ) : integrationsError ? (
                  <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs">
                    {integrationsError}
                  </div>
                ) : integrations.length === 0 ? (
                  <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800/80 space-y-4">
                    <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center text-slate-400">
                      <Server className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-white">No Integrations Configured</h3>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        Add a Linux server integration to initiate agent enrollment and monitor authentication events.
                      </p>
                    </div>
                    {isAnalyst && (
                      <button
                        onClick={() => setShowAddIntegrationModal(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Add First Integration
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-800 overflow-hidden bg-slate-900/40">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                          <tr>
                            <th className="py-3 px-4">Status</th>
                            <th className="py-3 px-4">Server / Integration Name</th>
                            <th className="py-3 px-4">Type</th>
                            <th className="py-3 px-4">Created</th>
                            <th className="py-3 px-4">Last Seen</th>
                            <th className="py-3 px-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 text-slate-300">
                          {integrations.map((item) => {
                            const fleetItem = fleetIntegrations.find((f) => f.id === item.id);
                            const currentHealth = fleetItem?.healthStatus || (item.status as any);
                            const diagnostics = fleetItem?.metadata?.agentDiagnostics || (item.metadata as any)?.agentDiagnostics;

                            return (
                            <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                {currentHealth === 'connected' ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-300 font-medium text-[11px]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    Connected
                                  </span>
                                ) : currentHealth === 'degraded' ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/80 border border-amber-800 text-amber-300 font-medium text-[11px]">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                                    Degraded
                                  </span>
                                ) : currentHealth === 'inactive' ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-950/80 border border-yellow-800 text-yellow-300 font-medium text-[11px]">
                                    <Clock className="w-3.5 h-3.5 text-yellow-400" />
                                    Inactive
                                  </span>
                                ) : item.status === 'pending' ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-950/80 border border-cyan-800 text-cyan-300 font-medium text-[11px]">
                                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                                    Pending Enrollment
                                  </span>
                                ) : item.status === 'revoked' ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-950/80 border border-rose-800 text-rose-300 font-medium text-[11px]">
                                    <Lock className="w-3.5 h-3.5 text-rose-400" />
                                    Revoked
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400 font-medium text-[11px]">
                                    <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
                                    Disconnected
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 font-medium text-white">
                                <div>{item.name}</div>
                                {diagnostics && (
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 border border-slate-700">
                                      Buffer: {diagnostics.pending_buffer_events ?? 0} queued
                                    </span>
                                    {diagnostics.line_number !== undefined && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 border border-slate-700">
                                        Lines: {diagnostics.line_number}
                                      </span>
                                    )}
                                    {diagnostics.agent_version && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-cyan-950/60 text-[10px] text-cyan-400 border border-cyan-800/40">
                                        v{diagnostics.agent_version}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="py-3.5 px-4">
                                <span className="font-mono text-cyan-300 bg-cyan-950/50 px-2 py-0.5 rounded border border-cyan-800/40 text-[11px]">
                                  {item.integrationType}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-slate-400">
                                {new Date(item.createdAt).toLocaleDateString()} {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="py-3.5 px-4 text-slate-400">
                                {item.lastSeenAt ? (
                                  `${new Date(item.lastSeenAt).toLocaleDateString()} ${new Date(item.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                ) : (
                                  <span className="text-slate-600 italic">Never (no agent connected)</span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                <button
                                  onClick={() => setSelectedIntegrationId(item.id)}
                                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 hover:text-white transition-colors text-xs font-medium inline-flex items-center gap-1.5"
                                >
                                  Manage & Enroll
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              // 2. Integration Detail & Enrollment View
              <div className="space-y-6">
                {/* Back button & Title */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <button
                    onClick={() => {
                      setSelectedIntegrationId(null);
                      setActiveEnrollmentToken(null);
                      fetchIntegrationsList();
                    }}
                    className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to All Integrations
                  </button>
                  <div className="flex items-center gap-2">
                    {selectedIntegrationDetail?.status !== 'revoked' && isAnalyst && (
                      <button
                        onClick={() => handleRevokeIntegration(selectedIntegrationId)}
                        disabled={revokingIntegration}
                        className="px-3.5 py-1.5 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-800/80 text-rose-300 text-xs font-medium transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        {revokingIntegration ? 'Revoking...' : 'Revoke Credentials'}
                      </button>
                    )}
                  </div>
                </div>

                {loadingIntegrationDetail || !selectedIntegrationDetail ? (
                  <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs flex items-center justify-center gap-3">
                    <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                    Loading integration details...
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Header Card */}
                    <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-3">
                            <h2 className="text-base font-bold text-white">{selectedIntegrationDetail.name}</h2>
                            {selectedIntegrationDetail.status === 'connected' ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-300 font-medium text-[11px]">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                Connected
                              </span>
                            ) : selectedIntegrationDetail.status === 'pending' ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/80 border border-amber-800 text-amber-300 font-medium text-[11px]">
                                <Clock className="w-3.5 h-3.5 text-amber-400" />
                                Pending Enrollment
                              </span>
                            ) : selectedIntegrationDetail.status === 'revoked' ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-950/80 border border-rose-800 text-rose-300 font-medium text-[11px]">
                                <Lock className="w-3.5 h-3.5 text-rose-400" />
                                Revoked
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400 font-medium text-[11px]">
                                {selectedIntegrationDetail.status}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400">
                            Type: <span className="font-mono text-cyan-300">{selectedIntegrationDetail.integrationType}</span> (Linux Authentication Logs)
                          </p>
                        </div>
                      </div>

                      {/* Metadata Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-slate-800/60 text-xs">
                        <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/60 space-y-1">
                          <span className="text-slate-400 text-[11px]">Integration ID</span>
                          <p className="font-mono text-slate-200 text-[11px] truncate">{selectedIntegrationDetail.id}</p>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/60 space-y-1">
                          <span className="text-slate-400 text-[11px]">Agent Identity</span>
                          <p className="font-mono text-slate-200 text-[11px] truncate">
                            {selectedIntegrationDetail.agentId || 'Awaiting Enrollment'}
                          </p>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/60 space-y-1">
                          <span className="text-slate-400 text-[11px]">Registered At</span>
                          <p className="text-slate-200 text-[11px]">
                            {new Date(selectedIntegrationDetail.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/60 space-y-1">
                          <span className="text-slate-400 text-[11px]">Last Verified Communication</span>
                          <p className="text-slate-200 text-[11px]">
                            {selectedIntegrationDetail.lastSeenAt
                              ? new Date(selectedIntegrationDetail.lastSeenAt).toLocaleString()
                              : 'No activity yet'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Active Enrollment Token Box (Displayed only once upon generation) */}
                    {activeEnrollmentToken && (
                      <div className="p-5 rounded-2xl bg-amber-950/40 border border-amber-600/80 space-y-3 animate-in fade-in">
                        <div className="flex items-center gap-2 text-amber-300 font-semibold text-xs">
                          <Key className="w-4 h-4 text-amber-400" />
                          <span>Active Enrollment Token Generated</span>
                        </div>
                        <div className="p-3 rounded-xl bg-amber-950/70 border border-amber-800 text-amber-200 text-xs leading-relaxed">
                          <strong>Security Warning:</strong> {activeEnrollmentToken.warning}
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-slate-300 font-medium">One-Time Enrollment Token:</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              readOnly
                              value={activeEnrollmentToken.token}
                              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-amber-700/60 font-mono text-xs text-amber-300 focus:outline-none select-all"
                            />
                            <button
                              onClick={() => handleCopyEnrollmentToken(activeEnrollmentToken.token)}
                              className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition-colors shrink-0 flex items-center gap-1.5"
                            >
                              {copiedEnrollmentToken ? (
                                <>
                                  <Check className="w-4 h-4" />
                                  Copied!
                                </>
                              ) : (
                                <>
                                  <Copy className="w-4 h-4" />
                                  Copy Token
                                </>
                              )}
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Expires at: {new Date(activeEnrollmentToken.expiresAt).toLocaleTimeString()} ({new Date(activeEnrollmentToken.expiresAt).toLocaleDateString()})
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Enrollment Action Card */}
                    <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                            <Key className="w-4 h-4 text-cyan-400" />
                            Enrollment & Agent Credentials
                          </h3>
                          <p className="text-xs text-slate-400">
                            Enrollment tokens are single-use, 256-bit cryptographically random tokens valid for 15 minutes.
                          </p>
                        </div>
                        {isAnalyst && selectedIntegrationDetail.status !== 'revoked' && (
                          <button
                            onClick={() => handleInitiateEnrollment(selectedIntegrationDetail.id)}
                            disabled={initiatingEnrollment}
                            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors shrink-0 flex items-center gap-2 disabled:opacity-50"
                          >
                            <Key className="w-4 h-4" />
                            {initiatingEnrollment ? 'Generating...' : 'Initiate Enrollment'}
                          </button>
                        )}
                      </div>

                      {selectedIntegrationDetail.status === 'revoked' && (
                        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs">
                          This integration has been revoked. All agent credentials and tokens are permanently invalidated.
                        </div>
                      )}
                    </div>

                    {/* Installation Guidance Card */}
                    <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                          <Terminal className="w-4 h-4 text-cyan-400" />
                          Linux Agent Installation & Enrollment Workflow
                        </h3>
                        <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-[11px]">
                          Preview: Agent Package in Development
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        The NomaanOS Sentinel Linux Agent is designed to collect and securely forward standard authentication events (<code className="text-cyan-300">/var/log/auth.log</code> on Debian/Ubuntu or <code className="text-cyan-300">/var/log/secure</code> on RHEL/CentOS).
                      </p>
                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                        <span className="text-[11px] font-medium text-slate-400">Enrollment Command Preview:</span>
                        <pre className="font-mono text-xs text-cyan-300 overflow-x-auto whitespace-pre-wrap p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                          {`# Once the sentinel-agent package is installed on your Linux host:
sudo sentinel-agent enroll --token ${activeEnrollmentToken ? activeEnrollmentToken.token : '<YOUR_ENROLLMENT_TOKEN>'}`}
                        </pre>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/60 text-xs text-slate-400 space-y-1">
                        <span className="font-semibold text-slate-300">Security & Integrity Assurance:</span>
                        <ul className="list-disc list-inside space-y-0.5 text-[11px] text-slate-400">
                          <li>Sentinel will never ask you to disable host firewalls or execute unverified remote scripts.</li>
                          <li>Enrollment tokens are single-use, hashed via SHA-256 before storage, and expire automatically after 15 minutes.</li>
                          <li>Enrolled agents receive a dedicated agent key separate from user sessions.</li>
                        </ul>
                      </div>
                    </div>

                    {/* Troubleshooting Guidance Card */}
                    <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
                      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <HelpCircle className="w-4 h-4 text-cyan-400" />
                        Enrollment Troubleshooting & Diagnostics
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                          <span className="font-semibold text-slate-200">Token Expired</span>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            Enrollment tokens expire 15 minutes after creation. Click <em>Initiate Enrollment</em> above to generate a new token.
                          </p>
                        </div>
                        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                          <span className="font-semibold text-slate-200">Single-Use Replay Rejection</span>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            Each token can be consumed exactly once. If re-enrolling or transferring a server, a new token must be issued.
                          </p>
                        </div>
                        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                          <span className="font-semibold text-slate-200">Credential Revocation</span>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            If a credential was revoked, the agent can no longer authenticate. You must re-enable enrollment by generating a fresh token.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Audit History Timeline */}
                    <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
                      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <Clock className="w-4 h-4 text-cyan-400" />
                        Integration Audit History ({integrationAuditLogs.length})
                      </h3>
                      {integrationAuditLogs.length === 0 ? (
                        <p className="text-xs text-slate-500 italic">No audit records recorded yet.</p>
                      ) : (
                        <div className="divide-y divide-slate-800/60 text-xs">
                          {integrationAuditLogs.map((log) => (
                            <div key={log.id} className="py-2.5 flex items-center justify-between gap-3">
                              <div className="space-y-0.5">
                                <span className="font-mono text-cyan-300 text-[11px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                                  {log.action}
                                </span>
                                <p className="text-slate-400 text-[11px]">
                                  Actor: {log.actorEmail || 'System / Agent'}
                                </p>
                              </div>
                              <span className="text-[11px] text-slate-500 whitespace-nowrap">
                                {new Date(log.createdAt).toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* Workspace Alert Notifications Tab Content                */}
        {/* ======================================================== */}
        {activeTab === 'notifications' && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
              <div>
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Bell className="w-4 h-4 text-cyan-400" />
                  Workspace Alert Notifications
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Configure automated email dispatch for security detections, manage alert thresholds, and monitor delivery history.
                </p>
              </div>
              <button
                onClick={fetchNotificationData}
                disabled={notificationsLoading}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors flex items-center gap-2 self-start sm:self-center"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${notificationsLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {/* Notification Preferences Card */}
            <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <Mail className="w-4 h-4 text-cyan-400" />
                  Notification Preferences & Routing
                </h3>
                {workspace?.myRole === 'viewer' && (
                  <span className="text-[11px] text-slate-500 italic">View-only mode (Admin/Owner can edit)</span>
                )}
              </div>

              {notificationsLoading && !notificationSettings ? (
                <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                  Loading notification settings...
                </div>
              ) : notificationSettings ? (
                <div className="space-y-4 text-xs">
                  {/* Enable / Disable Switch */}
                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                    <div>
                      <span className="font-medium text-white block">Automated Email Notifications</span>
                      <span className="text-[11px] text-slate-400">
                        When enabled, newly detected threats matching the severity threshold are immediately dispatched via email.
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={workspace?.myRole === 'viewer'}
                      onClick={() =>
                        setNotificationSettings({
                          ...notificationSettings,
                          enabled: !notificationSettings.enabled,
                        })
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                        notificationSettings.enabled ? 'bg-cyan-600' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          notificationSettings.enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Minimum Severity Filter */}
                    <div className="space-y-1.5 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                      <label className="text-slate-300 font-medium block">Minimum Alert Severity Threshold</label>
                      <p className="text-[11px] text-slate-500 mb-2">
                        Only dispatch email notifications for alerts that meet or exceed this severity rank.
                      </p>
                      <select
                        disabled={workspace?.myRole === 'viewer'}
                        value={notificationSettings.minSeverity}
                        onChange={(e) =>
                          setNotificationSettings({
                            ...notificationSettings,
                            minSeverity: e.target.value as any,
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                      >
                        <option value="info">Info (All Alerts: Info, Low, Medium, High, Critical)</option>
                        <option value="low">Low (Low, Medium, High, Critical)</option>
                        <option value="medium">Medium (Medium, High, Critical - Recommended)</option>
                        <option value="high">High (High and Critical Only)</option>
                        <option value="critical">Critical (Critical Severity Only)</option>
                      </select>
                    </div>

                    {/* Evidence Summary Checkbox */}
                    <div className="space-y-1.5 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col justify-between">
                      <div>
                        <label className="text-slate-300 font-medium block">Evidence Summary Inclusion</label>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Embed supporting security event summaries directly into alert notification emails.
                        </p>
                      </div>
                      <label className="inline-flex items-center gap-2 cursor-pointer mt-2">
                        <input
                          type="checkbox"
                          disabled={workspace?.myRole === 'viewer'}
                          checked={notificationSettings.includeEvidenceSummary}
                          onChange={(e) =>
                            setNotificationSettings({
                              ...notificationSettings,
                              includeEvidenceSummary: e.target.checked,
                            })
                          }
                          className="rounded bg-slate-900 border-slate-700 text-cyan-600 focus:ring-cyan-500"
                        />
                        <span className="text-slate-300 font-medium text-xs">Include supporting evidence details</span>
                      </label>
                    </div>
                  </div>

                  {/* Recipient Emails Manager */}
                  <div className="space-y-2 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                    <label className="text-slate-300 font-medium block">Notification Recipients</label>
                    <p className="text-[11px] text-slate-500">
                      Security analysts or distribution lists that receive automated alert notifications.
                    </p>

                    {/* Chips */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {notificationSettings.notifyEmails.length === 0 ? (
                        <span className="text-[11px] text-slate-500 italic">No recipient emails configured. Add below.</span>
                      ) : (
                        notificationSettings.notifyEmails.map((email) => (
                          <span
                            key={email}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-cyan-300 text-xs font-mono"
                          >
                            {email}
                            {workspace?.myRole !== 'viewer' && (
                              <button
                                type="button"
                                onClick={() => handleRemoveRecipientEmail(email)}
                                className="text-slate-500 hover:text-rose-400 transition-colors"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        ))
                      )}
                    </div>

                    {/* Add Email Input */}
                    {workspace?.myRole !== 'viewer' && (
                      <div className="flex items-center gap-2 pt-2">
                        <input
                          type="email"
                          placeholder="analyst@organization.com"
                          value={newEmailInput}
                          onChange={(e) => setNewEmailInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddRecipientEmail();
                            }
                          }}
                          className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 w-full max-w-sm"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddRecipientEmail()}
                          className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                        >
                          Add Email
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Actions Bar */}
                  {workspace?.myRole !== 'viewer' && (
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={handleSendTestNotification}
                        disabled={testEmailLoading || notificationSettings.notifyEmails.length === 0}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-medium transition-colors flex items-center gap-2 disabled:opacity-40"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {testEmailLoading ? 'Dispatching...' : 'Send Test Notification Email'}
                      </button>

                      <button
                        type="button"
                        onClick={handleSaveNotificationSettings}
                        disabled={notificationsSaving}
                        className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
                      >
                        {notificationsSaving ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            Save Preferences
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Notification Delivery History */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Delivery Audit Log</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Immutable history of dispatched security alert notifications and status proofs.
                  </p>
                </div>
                <span className="text-xs text-slate-500">
                  Total Dispatched: {notificationHistory.length}
                </span>
              </div>

              {notificationHistory.length === 0 ? (
                <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800/80 space-y-2">
                  <div className="w-10 h-10 mx-auto rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center text-slate-400">
                    <Bell className="w-5 h-5" />
                  </div>
                  <h4 className="text-xs font-medium text-slate-300">No Notifications Dispatched Yet</h4>
                  <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                    When security detection rules generate qualifying alerts, automated email records will appear here.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-800 overflow-hidden bg-slate-900/40">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                        <tr>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Alert Title</th>
                          <th className="py-3 px-4">Severity</th>
                          <th className="py-3 px-4">Recipient</th>
                          <th className="py-3 px-4">Dispatched At</th>
                          <th className="py-3 px-4">Attempts</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 text-slate-300">
                        {notificationHistory.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                            <td className="py-3 px-4 whitespace-nowrap">
                              {item.status === 'sent' ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-300 font-medium text-[11px]">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                  Sent
                                </span>
                              ) : item.status === 'failed' ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-950/80 border border-rose-800 text-rose-300 font-medium text-[11px]" title={item.errorMessage || 'Dispatch failed'}>
                                  <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                                  Failed
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-950/80 border border-amber-800 text-amber-300 font-medium text-[11px]">
                                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                                  Pending
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-medium text-white max-w-xs truncate">
                              {item.alertTitle}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wider ${
                                  item.alertSeverity === 'critical'
                                    ? 'bg-rose-950 text-rose-400 border border-rose-800/50'
                                    : item.alertSeverity === 'high'
                                    ? 'bg-orange-950 text-orange-400 border border-orange-800/50'
                                    : item.alertSeverity === 'medium'
                                    ? 'bg-amber-950 text-amber-400 border border-amber-800/50'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {item.alertSeverity}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-cyan-300 text-[11px]">
                              {item.recipientEmail}
                            </td>
                            <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                              {item.sentAt || item.lastAttemptAt
                                ? new Date(item.sentAt || item.lastAttemptAt!).toLocaleString()
                                : new Date(item.createdAt).toLocaleString()}
                            </td>
                            <td className="py-3 px-4 text-slate-400 text-center font-mono">
                              {item.attempts}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Add Integration Modal */}
        {showAddIntegrationModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Server className="w-4 h-4 text-cyan-400" />
                  Add Monitored Asset / Integration
                </h3>
                <button
                  onClick={() => setShowAddIntegrationModal(false)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateIntegration} className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">Integration / Server Name</label>
                  <input
                    type="text"
                    required
                    value={newIntegrationName}
                    onChange={(e) => setNewIntegrationName(e.target.value)}
                    placeholder="e.g. prod-auth-gateway-01"
                    maxLength={255}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">Integration Type</label>
                  <select
                    disabled
                    value="linux_auth"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 focus:outline-none opacity-80 cursor-not-allowed"
                  >
                    <option value="linux_auth">Linux Authentication Logs (auth.log / secure)</option>
                  </select>
                  <p className="text-[11px] text-slate-500">
                    Currently supported: Linux authentication log monitoring via future agent collection.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium">Environment</label>
                  <select
                    value={newIntegrationEnv}
                    onChange={(e) => setNewIntegrationEnv(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="development">Development</option>
                  </select>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddIntegrationModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingIntegration}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    {creatingIntegration ? 'Creating...' : 'Create Integration'}
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
