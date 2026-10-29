// apps/api/src/config/plans.ts
// Centralized server-side plan definitions and tier entitlements for NomaanOS Sentinel

export type PlanId = 'free' | 'starter' | 'pro' | 'msp';

export interface PlanFeatures {
  canUseAiInvestigations: boolean;
  canUseOutboundWebhooks: boolean;
  canUseMspConsole: boolean;
  canExportReports: boolean;
}

export interface PlanLimits {
  /** Maximum client workspaces allowed under an MSP organization. 0 means organization/multi-client disabled. */
  maxClientWorkspaces: number;
  /** Maximum registered agent integrations per workspace. */
  maxIntegrationsPerWorkspace: number;
  /** Maximum security events ingested per monthly billing cycle per workspace. */
  maxMonthlyEventsPerWorkspace: number;
  /** Log retention period in days. */
  retentionDays: number;
}

export interface PlanPricing {
  currency: 'INR';
  amountPaise: number;
  displayPrice: string;
  interval: 'monthly' | 'yearly';
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  description: string;
  pricing: PlanPricing;
  limits: PlanLimits;
  features: PlanFeatures;
  razorpayPlanId?: string; // Optional Razorpay plan ID override in environment
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Sentinel Community / Free',
    description: 'Essential endpoint log ingestion and security alerting for individuals and small test environments.',
    pricing: {
      currency: 'INR',
      amountPaise: 0,
      displayPrice: '₹0/month',
      interval: 'monthly',
    },
    limits: {
      maxClientWorkspaces: 0,
      maxIntegrationsPerWorkspace: 1,
      maxMonthlyEventsPerWorkspace: 10_000,
      retentionDays: 7,
    },
    features: {
      canUseAiInvestigations: false,
      canUseOutboundWebhooks: false,
      canUseMspConsole: false,
      canExportReports: false,
    },
  },
  starter: {
    id: 'starter',
    name: 'Sentinel Starter',
    description: 'Continuous monitoring for small growing teams with webhook alerting and up to 5 agent integrations.',
    pricing: {
      currency: 'INR',
      amountPaise: 499900, // ₹4,999 / mo
      displayPrice: '₹4,999/month',
      interval: 'monthly',
    },
    limits: {
      maxClientWorkspaces: 1,
      maxIntegrationsPerWorkspace: 5,
      maxMonthlyEventsPerWorkspace: 250_000,
      retentionDays: 30,
    },
    features: {
      canUseAiInvestigations: false,
      canUseOutboundWebhooks: true,
      canUseMspConsole: false,
      canExportReports: true,
    },
  },
  pro: {
    id: 'pro',
    name: 'Sentinel Professional',
    description: 'High-volume detection engineering, AI assistant investigations, and advanced alert automation.',
    pricing: {
      currency: 'INR',
      amountPaise: 1999900, // ₹19,999 / mo
      displayPrice: '₹19,999/month',
      interval: 'monthly',
    },
    limits: {
      maxClientWorkspaces: 5,
      maxIntegrationsPerWorkspace: 25,
      maxMonthlyEventsPerWorkspace: 2_000_000,
      retentionDays: 90,
    },
    features: {
      canUseAiInvestigations: true,
      canUseOutboundWebhooks: true,
      canUseMspConsole: false,
      canExportReports: true,
    },
  },
  msp: {
    id: 'msp',
    name: 'Sentinel MSP Multi-Tenant Platform',
    description: 'Dedicated multi-client security operations center with consolidated fleet monitoring and 50 client workspaces.',
    pricing: {
      currency: 'INR',
      amountPaise: 4999900, // ₹49,999 / mo
      displayPrice: '₹49,999/month',
      interval: 'monthly',
    },
    limits: {
      maxClientWorkspaces: 50,
      maxIntegrationsPerWorkspace: 100,
      maxMonthlyEventsPerWorkspace: 10_000_000,
      retentionDays: 365,
    },
    features: {
      canUseAiInvestigations: true,
      canUseOutboundWebhooks: true,
      canUseMspConsole: true,
      canExportReports: true,
    },
  },
};

export function isValidPlan(planId: string): planId is PlanId {
  return Object.prototype.hasOwnProperty.call(PLANS, planId);
}

export function getPlanDefinition(planId: string): PlanDefinition {
  if (isValidPlan(planId)) {
    return PLANS[planId];
  }
  return PLANS.free;
}

export function getAllPlans(): PlanDefinition[] {
  return Object.values(PLANS);
}

