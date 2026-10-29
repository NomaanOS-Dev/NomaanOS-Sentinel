import { describe, it, expect } from 'vitest';
import {
  GeminiAiProvider,
  OpenAiAiProvider,
  MockAiProvider,
  UnconfiguredAiProvider,
  AiProviderError,
} from '../src/services/ai-provider.js';

describe('AI Provider Adapter Architecture', () => {
  describe('Unconfigured Provider', () => {
    it('reports isConfigured() = false and throws PROVIDER_NOT_CONFIGURED on execution', async () => {
      const provider = new UnconfiguredAiProvider('none');
      expect(provider.isConfigured()).toBe(false);

      await expect(
        provider.generateInvestigation({
          systemInstruction: 'Test',
          prompt: 'Test',
        })
      ).rejects.toThrowError(AiProviderError);

      try {
        await provider.generateInvestigation({
          systemInstruction: 'Test',
          prompt: 'Test',
        });
      } catch (err: any) {
        expect(err.code).toBe('PROVIDER_NOT_CONFIGURED');
        expect(err.statusCode).toBe(503);
      }
    });
  });

  describe('Gemini Provider Configuration & Safety', () => {
    it('detects missing API credentials safely without throwing at instantiation', () => {
      const provider = new GeminiAiProvider('', 'gemini-1.5-pro');
      expect(provider.isConfigured()).toBe(false);
    });

    it('rejects execution with PROVIDER_NOT_CONFIGURED when API key is missing', async () => {
      const provider = new GeminiAiProvider('', 'gemini-1.5-pro');
      await expect(
        provider.generateInvestigation({
          systemInstruction: 'System',
          prompt: 'Prompt',
        })
      ).rejects.toMatchObject({
        code: 'PROVIDER_NOT_CONFIGURED',
        statusCode: 503,
      });
    });
  });

  describe('OpenAI Provider Configuration & Safety', () => {
    it('detects missing API credentials safely', () => {
      const provider = new OpenAiAiProvider('', 'gpt-4o-mini');
      expect(provider.isConfigured()).toBe(false);
    });

    it('rejects execution with PROVIDER_NOT_CONFIGURED when API key is empty', async () => {
      const provider = new OpenAiAiProvider('', 'gpt-4o-mini');
      await expect(
        provider.generateInvestigation({
          systemInstruction: 'System',
          prompt: 'Prompt',
        })
      ).rejects.toMatchObject({
        code: 'PROVIDER_NOT_CONFIGURED',
        statusCode: 503,
      });
    });
  });

  describe('Mock Provider Simulated Error Conditions', () => {
    it('successfully produces structured response under normal operation', async () => {
      const mock = new MockAiProvider({ mode: 'success', delayMs: 5 });
      expect(mock.isConfigured()).toBe(true);

      const res = await mock.generateInvestigation({
        systemInstruction: 'Analyze',
        prompt: 'Here is evidence: {"event_id": "11111111-1111-1111-1111-111111111111"}',
      });

      expect(res.provider).toBe('mock');
      expect(res.model).toBe('mock-model-v1');
      expect(typeof res.rawText).toBe('string');
      const parsed = JSON.parse(res.rawText);
      expect(parsed.summary).toBeDefined();
      expect(Array.isArray(parsed.observed_facts)).toBe(true);
      expect(Array.isArray(parsed.hypotheses)).toBe(true);
      expect(Array.isArray(parsed.unknowns)).toBe(true);
      expect(parsed.supporting_event_ids).toContain('11111111-1111-1111-1111-111111111111');
    });

    it('simulates timeout and normalizes into PROVIDER_TIMEOUT (HTTP 504)', async () => {
      const mock = new MockAiProvider({ mode: 'timeout', delayMs: 5 });
      await expect(
        mock.generateInvestigation({ systemInstruction: 'S', prompt: 'P' })
      ).rejects.toMatchObject({
        code: 'PROVIDER_TIMEOUT',
        statusCode: 504,
      });
    });

    it('simulates provider outage and normalizes into PROVIDER_UNAVAILABLE (HTTP 503)', async () => {
      const mock = new MockAiProvider({ mode: 'unavailable', delayMs: 5 });
      await expect(
        mock.generateInvestigation({ systemInstruction: 'S', prompt: 'P' })
      ).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
        statusCode: 503,
      });
    });

    it('simulates provider rate limiting and normalizes into RATE_LIMIT_EXCEEDED (HTTP 429)', async () => {
      const mock = new MockAiProvider({ mode: 'rate_limit', delayMs: 5 });
      await expect(
        mock.generateInvestigation({ systemInstruction: 'S', prompt: 'P' })
      ).rejects.toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
        statusCode: 429,
      });
    });

    it('simulates provider quota exhaustion and normalizes into QUOTA_EXHAUSTED (HTTP 403)', async () => {
      const mock = new MockAiProvider({ mode: 'quota_exhausted', delayMs: 5 });
      await expect(
        mock.generateInvestigation({ systemInstruction: 'S', prompt: 'P' })
      ).rejects.toMatchObject({
        code: 'QUOTA_EXHAUSTED',
        statusCode: 403,
      });
    });

    it('returns malformed non-JSON text when configured in malformed mode', async () => {
      const mock = new MockAiProvider({ mode: 'malformed_json', delayMs: 5 });
      const res = await mock.generateInvestigation({ systemInstruction: 'S', prompt: 'P' });
      expect(res.rawText).toContain('This is not JSON');
      expect(() => JSON.parse(res.rawText)).toThrow();
    });
  });

  describe('Real Transport Envelope & Response Extraction Verification', () => {
    const validCanonicalJson = JSON.stringify({
      summary: 'Automated authentication failures detected from external IP.',
      observed_facts: ['Repeated failed attempts targeting root account.'],
      hypotheses: ['Automated credential stuffing or dictionary attack.'],
      unknowns: ['Targeted asset network perimeter status.'],
      supporting_event_ids: ['11111111-1111-1111-1111-111111111111'],
      suggested_checks: ['Verify rate-limiting and fail2ban rules on bastion host.'],
      client_summary_draft: 'DRAFT: Investigation into authentication failure burst on bastion host.',
      limitations: ['Limited to auth.log event data in this workspace.'],
    });

    it('extracts and validates a realistic OpenAI chat completion envelope', async () => {
      const openAiEnvelope = {
        id: 'chatcmpl-test-12345',
        object: 'chat.completion',
        created: 1730000000,
        model: 'gpt-4o-mini',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: validCanonicalJson,
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 350,
          completion_tokens: 180,
          total_tokens: 530,
        },
      };

      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () =>
          new Response(JSON.stringify(openAiEnvelope), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });

        const provider = new OpenAiAiProvider('test-valid-key-12345', 'gpt-4o-mini');
        const res = await provider.generateInvestigation({
          systemInstruction: 'System',
          prompt: 'Prompt',
        });

        expect(res.provider).toBe('openai');
        expect(res.model).toBe('gpt-4o-mini');
        expect(res.promptTokens).toBe(350);
        expect(res.completionTokens).toBe(180);

        const parsed = JSON.parse(res.rawText);
        expect(parsed.summary).toContain('Automated authentication failures');
        expect(parsed.supporting_event_ids).toContain('11111111-1111-1111-1111-111111111111');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('extracts and validates a realistic Google Gemini candidate content envelope', async () => {
      const geminiEnvelope = {
        candidates: [
          {
            content: {
              parts: [{ text: validCanonicalJson }],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 310,
          candidatesTokenCount: 160,
          totalTokenCount: 470,
        },
      };

      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () =>
          new Response(JSON.stringify(geminiEnvelope), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });

        const provider = new GeminiAiProvider('test-valid-key-12345', 'gemini-1.5-pro');
        const res = await provider.generateInvestigation({
          systemInstruction: 'System',
          prompt: 'Prompt',
        });

        expect(res.provider).toBe('gemini');
        expect(res.model).toBe('gemini-1.5-pro');
        expect(res.promptTokens).toBe(310);
        expect(res.completionTokens).toBe(160);

        const parsed = JSON.parse(res.rawText);
        expect(parsed.summary).toContain('Automated authentication failures');
        expect(parsed.observed_facts.length).toBeGreaterThan(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

