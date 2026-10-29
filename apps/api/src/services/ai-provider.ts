/**
 * ai-provider.ts
 * NomaanOS Sentinel: AI Provider Adapter Architecture.
 *
 * Implements an isolated, bounded, mockable provider adapter with safe error normalization,
 * cancellation, timeouts, and zero client-side credential leakage.
 */

import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
  OPENAI_INVESTIGATION_JSON_SCHEMA,
  GEMINI_INVESTIGATION_SCHEMA,
} from './ai-response-validator.js';

export type AiErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMIT_EXCEEDED'
  | 'QUOTA_EXHAUSTED'
  | 'MALFORMED_RESPONSE'
  | 'MALFORMED_JSON'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'INVALID_CITATIONS'
  | 'CONTEXT_TOO_LARGE'
  | 'INTERNAL_ERROR';

export class AiProviderError extends Error {
  public readonly code: AiErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: AiErrorCode, message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'AiProviderError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export interface AiProviderRequest {
  systemInstruction: string;
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AiProviderResponse {
  rawText: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

export interface AiProviderAdapter {
  readonly providerName: string;
  isConfigured(): boolean;
  generateInvestigation(req: AiProviderRequest): Promise<AiProviderResponse>;
}

// -------------------------------------------------------------
// Google Gemini Provider Adapter (REST via native fetch)
// -------------------------------------------------------------
export class GeminiAiProvider implements AiProviderAdapter {
  public readonly providerName = 'gemini';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly defaultTimeoutMs: number;

  constructor(apiKey?: string, model?: string, defaultTimeoutMs = 30000) {
    this.apiKey = typeof apiKey === 'string' ? apiKey : (config.ai.apiKey || '');
    this.model = model || config.ai.model || 'gemini-1.5-pro';
    this.defaultTimeoutMs = defaultTimeoutMs || config.ai.timeoutMs || 30000;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 5);
  }

  async generateInvestigation(req: AiProviderRequest): Promise<AiProviderResponse> {
    if (!this.isConfigured()) {
      throw new AiProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'Google Gemini AI provider is not configured. Please set AI_API_KEY or GEMINI_API_KEY.',
        503
      );
    }

    const timeoutMs = req.timeoutMs || this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    // Combine caller signal with timeout controller if provided
    if (req.signal) {
      req.signal.addEventListener('abort', () => controller.abort());
    }

    const startTime = Date.now();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const body: Record<string, unknown> = {
      contents: [
        {
          role: 'user',
          parts: [{ text: req.prompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: req.systemInstruction }],
      },
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_INVESTIGATION_SCHEMA,
      },
    };

    try {
      let response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const durationMs = Date.now() - startTime;

      if (!response.ok && response.status === 400) {
        // Fallback without responseSchema if unsupported on custom model endpoints
        body.generationConfig = {
          temperature: 0.1,
          responseMimeType: 'application/json',
        };
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn({ status: response.status, provider: 'gemini', durationMs }, 'Gemini API call failed');

        if (response.status === 429) {
          throw new AiProviderError('RATE_LIMIT_EXCEEDED', 'Gemini provider rate limit or quota exceeded.', 429);
        }
        if (response.status === 403) {
          throw new AiProviderError('QUOTA_EXHAUSTED', 'Gemini API quota exhausted or key unauthorized.', 403);
        }
        if (response.status >= 500) {
          throw new AiProviderError('PROVIDER_UNAVAILABLE', 'Gemini service is temporarily unavailable.', 503);
        }
        throw new AiProviderError('PROVIDER_UNAVAILABLE', `Gemini returned HTTP ${response.status}`, 502);
      }

      const data = (await response.json()) as any;
      const candidateParts = data?.candidates?.[0]?.content?.parts;
      const candidateText = Array.isArray(candidateParts)
        ? candidateParts.map((p: any) => p?.text || '').join('')
        : data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!candidateText || typeof candidateText !== 'string' || !candidateText.trim()) {
        throw new AiProviderError('MALFORMED_RESPONSE', 'Gemini returned empty or unexpected response structure.', 502);
      }

      const promptTokens = data?.usageMetadata?.promptTokenCount || 0;
      const completionTokens = data?.usageMetadata?.candidatesTokenCount || 0;

      return {
        rawText: candidateText,
        model: this.model,
        provider: 'gemini',
        promptTokens,
        completionTokens,
        durationMs,
      };
    } catch (err: any) {
      if (err instanceof AiProviderError) throw err;

      if (err.name === 'AbortError') {
        throw new AiProviderError(
          'PROVIDER_TIMEOUT',
          `Gemini request timed out after ${timeoutMs}ms.`,
          504
        );
      }
      throw new AiProviderError(
        'PROVIDER_UNAVAILABLE',
        `Network failure connecting to Gemini: ${err.message}`,
        503
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

// -------------------------------------------------------------
// OpenAI Provider Adapter (REST via native fetch)
// -------------------------------------------------------------
export class OpenAiAiProvider implements AiProviderAdapter {
  public readonly providerName = 'openai';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly defaultTimeoutMs: number;

  constructor(apiKey?: string, model?: string, defaultTimeoutMs = 30000) {
    this.apiKey = typeof apiKey === 'string' ? apiKey : (config.ai.apiKey || '');
    this.model = model || config.ai.model || 'gpt-4o-mini';
    this.defaultTimeoutMs = defaultTimeoutMs || config.ai.timeoutMs || 30000;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 5);
  }

  async generateInvestigation(req: AiProviderRequest): Promise<AiProviderResponse> {
    if (!this.isConfigured()) {
      throw new AiProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'OpenAI provider is not configured. Please set AI_API_KEY or OPENAI_API_KEY.',
        503
      );
    }

    const timeoutMs = req.timeoutMs || this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    if (req.signal) {
      req.signal.addEventListener('abort', () => controller.abort());
    }

    const startTime = Date.now();
    const endpoint = 'https://api.openai.com/v1/chat/completions';

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: req.systemInstruction },
        { role: 'user', content: req.prompt },
      ],
      temperature: 0.1,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'ai_investigation_response',
          strict: true,
          schema: OPENAI_INVESTIGATION_JSON_SCHEMA,
        },
      },
    };

    try {
      let response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const durationMs = Date.now() - startTime;

      if (!response.ok && response.status === 400) {
        // Fallback to json_object if custom model/proxy does not support json_schema
        body.response_format = { type: 'json_object' };
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      }

      if (!response.ok) {
        if (response.status === 429) {
          throw new AiProviderError('RATE_LIMIT_EXCEEDED', 'OpenAI provider rate limit or quota exceeded.', 429);
        }
        if (response.status === 401 || response.status === 403) {
          throw new AiProviderError('QUOTA_EXHAUSTED', 'OpenAI key unauthorized or quota exhausted.', 403);
        }
        if (response.status >= 500) {
          throw new AiProviderError('PROVIDER_UNAVAILABLE', 'OpenAI service temporarily unavailable.', 503);
        }
        throw new AiProviderError('PROVIDER_UNAVAILABLE', `OpenAI returned HTTP ${response.status}`, 502);
      }

      const data = (await response.json()) as any;
      const choice = data?.choices?.[0];
      const candidateText = choice?.message?.content;
      if (!candidateText || typeof candidateText !== 'string' || !candidateText.trim()) {
        const finishReason = choice?.finish_reason;
        if (finishReason === 'length') {
          throw new AiProviderError('CONTEXT_TOO_LARGE', 'OpenAI response truncated due to token limit.', 502);
        }
        if (finishReason === 'content_filter') {
          throw new AiProviderError('MALFORMED_RESPONSE', 'OpenAI response omitted due to content filter.', 502);
        }
        throw new AiProviderError('MALFORMED_RESPONSE', 'OpenAI returned empty or unexpected response structure.', 502);
      }

      const promptTokens = data?.usage?.prompt_tokens || 0;
      const completionTokens = data?.usage?.completion_tokens || 0;

      return {
        rawText: candidateText,
        model: this.model,
        provider: 'openai',
        promptTokens,
        completionTokens,
        durationMs,
      };
    } catch (err: any) {
      if (err instanceof AiProviderError) throw err;
      if (err.name === 'AbortError') {
        throw new AiProviderError('PROVIDER_TIMEOUT', `OpenAI request timed out after ${timeoutMs}ms.`, 504);
      }
      throw new AiProviderError('PROVIDER_UNAVAILABLE', `Network failure connecting to OpenAI: ${err.message}`, 503);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

// -------------------------------------------------------------
// Mock / Offline Test Provider Adapter
// -------------------------------------------------------------
export interface MockProviderOptions {
  mode?: 'success' | 'timeout' | 'unavailable' | 'rate_limit' | 'quota_exhausted' | 'malformed_json' | 'invalid_citations';
  customResponseText?: string;
  delayMs?: number;
  invalidCitationId?: string;
}

export class MockAiProvider implements AiProviderAdapter {
  public readonly providerName = 'mock';
  private options: MockProviderOptions;

  constructor(options: MockProviderOptions = {}) {
    this.options = { mode: 'success', delayMs: 10, ...options };
  }

  setOptions(options: MockProviderOptions): void {
    this.options = { ...this.options, ...options };
  }

  isConfigured(): boolean {
    return true;
  }

  async generateInvestigation(req: AiProviderRequest): Promise<AiProviderResponse> {
    const delay = this.options.delayMs ?? 10;
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }

    if (this.options.mode === 'timeout') {
      throw new AiProviderError('PROVIDER_TIMEOUT', 'Simulated AI provider timeout.', 504);
    }
    if (this.options.mode === 'unavailable') {
      throw new AiProviderError('PROVIDER_UNAVAILABLE', 'Simulated AI provider connection outage.', 503);
    }
    if (this.options.mode === 'rate_limit') {
      throw new AiProviderError('RATE_LIMIT_EXCEEDED', 'Simulated provider rate limit exceeded (HTTP 429).', 429);
    }
    if (this.options.mode === 'quota_exhausted') {
      throw new AiProviderError('QUOTA_EXHAUSTED', 'Simulated provider quota exhausted.', 403);
    }
    if (this.options.mode === 'malformed_json') {
      return {
        rawText: 'This is not JSON at all: { bad_syntax: true ',
        model: 'mock-model-v1',
        provider: 'mock',
        promptTokens: 120,
        completionTokens: 25,
        durationMs: delay,
      };
    }

    if (this.options.customResponseText) {
      return {
        rawText: this.options.customResponseText,
        model: 'mock-model-v1',
        provider: 'mock',
        promptTokens: 200,
        completionTokens: 150,
        durationMs: delay,
      };
    }

    // Default grounded mock response: extracts event_id from prompt if available
    const eventIdMatches = Array.from(req.prompt.matchAll(/"event_id":\s*"([a-f0-9\-]+)"/gi)).map((m) => m[1]);
    let citedIds = eventIdMatches.slice(0, 3);

    if (this.options.mode === 'invalid_citations') {
      citedIds = [this.options.invalidCitationId || '00000000-0000-0000-0000-000000000000'];
    }

    const mockOutput = {
      summary: 'Analysis of security events indicates repetitive unauthorized authentication attempts followed by suspicious activity.',
      observed_facts: [
        'Multiple failed SSH login attempts recorded from external source IP within a narrow time window.',
        'Target username was consistently root across the recorded failure events.',
        'Deterministic brute-force detection alert was triggered based on persisted event records.',
      ],
      hypotheses: [
        'An automated credential-stuffing or dictionary attack was directed against port 22.',
        'Threat actor may have attempted horizontal privilege escalation after gaining access.',
      ],
      unknowns: [
        'Whether successful login occurred outside the time boundary of this ingested dataset.',
        'Geographic and ASN origin of source IP cannot be confirmed without external threat intel feeds.',
      ],
      supporting_event_ids: citedIds,
      suggested_checks: [
        'Review firewall logs for other inbound connections from the observed source IP.',
        'Audit authorized_keys file on target host for unauthorized public keys.',
        'Verify if password authentication on SSH is disabled in favor of key-based auth.',
      ],
      client_summary_draft: 'DRAFT FOR CLIENT: During our security monitoring, Sentinel detected a sequence of failed authentication attempts targeting administrative credentials. The activity was identified and contained. Further defensive hardening of SSH access has been recommended.',
      limitations: [
        'Analysis is grounded strictly in the security events ingested into this dataset.',
        'External network traffic and host-level memory captures were not available for correlation.',
      ],
    };

    return {
      rawText: JSON.stringify(mockOutput, null, 2),
      model: 'mock-model-v1',
      provider: 'mock',
      promptTokens: 250,
      completionTokens: 180,
      durationMs: delay,
    };
  }
}

// -------------------------------------------------------------
// Unconfigured Provider Adapter
// -------------------------------------------------------------
export class UnconfiguredAiProvider implements AiProviderAdapter {
  public readonly providerName: string;

  constructor(providerName = 'none') {
    this.providerName = providerName;
  }

  isConfigured(): boolean {
    return false;
  }

  async generateInvestigation(): Promise<AiProviderResponse> {
    throw new AiProviderError(
      'PROVIDER_NOT_CONFIGURED',
      `AI provider "${this.providerName}" is not configured with required API credentials. Please set AI_PROVIDER and provider API keys in environment.`,
      503
    );
  }
}

// -------------------------------------------------------------
// Provider Factory & Singleton
// -------------------------------------------------------------
let activeProvider: AiProviderAdapter | null = null;

export function getAiProvider(): AiProviderAdapter {
  if (activeProvider) {
    return activeProvider;
  }

  const configuredProvider = (config.ai.provider || 'none').toLowerCase();

  switch (configuredProvider) {
    case 'gemini':
      activeProvider = new GeminiAiProvider();
      break;
    case 'openai':
      activeProvider = new OpenAiAiProvider();
      break;
    case 'mock':
      activeProvider = new MockAiProvider();
      break;
    default:
      activeProvider = new UnconfiguredAiProvider(configuredProvider);
      break;
  }

  return activeProvider;
}

export function setAiProvider(provider: AiProviderAdapter | null): void {
  activeProvider = provider;
}
