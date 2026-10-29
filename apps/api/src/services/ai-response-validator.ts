/**
 * ai-response-validator.ts
 * NomaanOS Sentinel: Structured Response Schema and Citation Validator for AI Output.
 *
 * Enforces schema compliance, string bounds, and strict citation allowlist validation.
 */

import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv2020Class: any = (Ajv2020Module as any).default || Ajv2020Module;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addFormatsFn: any = (addFormatsModule as any).default || addFormatsModule;

const ajv = new Ajv2020Class({ allErrors: true, strict: false });
addFormatsFn(ajv);

export interface AiInvestigationResponse {
  summary: string;
  observed_facts: string[];
  hypotheses: string[];
  unknowns: string[];
  supporting_event_ids: string[];
  suggested_checks: string[];
  client_summary_draft: string;
  limitations: string[];
}

export const AI_INVESTIGATION_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: [
    'summary',
    'observed_facts',
    'hypotheses',
    'unknowns',
    'supporting_event_ids',
    'suggested_checks',
    'client_summary_draft',
    'limitations',
  ],
  additionalProperties: false,
  properties: {
    summary: {
      type: 'string',
      minLength: 10,
      maxLength: 3000,
    },
    observed_facts: {
      type: 'array',
      items: {
        type: 'string',
        minLength: 5,
        maxLength: 1000,
      },
      minItems: 1,
      maxItems: 30,
    },
    hypotheses: {
      type: 'array',
      items: {
        type: 'string',
        minLength: 5,
        maxLength: 1000,
      },
      maxItems: 15,
    },
    unknowns: {
      type: 'array',
      items: {
        type: 'string',
        minLength: 5,
        maxLength: 1000,
      },
      maxItems: 15,
    },
    supporting_event_ids: {
      type: 'array',
      items: {
        type: 'string',
        format: 'uuid',
      },
      maxItems: 50,
    },
    suggested_checks: {
      type: 'array',
      items: {
        type: 'string',
        minLength: 5,
        maxLength: 1000,
      },
      minItems: 1,
      maxItems: 20,
    },
    client_summary_draft: {
      type: 'string',
      minLength: 10,
      maxLength: 5000,
    },
    limitations: {
      type: 'array',
      items: {
        type: 'string',
        minLength: 5,
        maxLength: 1000,
      },
      minItems: 1,
      maxItems: 20,
    },
  },
};

/**
 * Strict schema for OpenAI Structured Outputs (response_format: json_schema).
 * Ensures OpenAI strictly adheres to the canonical investigation response structure.
 */
export const OPENAI_INVESTIGATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Objective executive summary of the investigation' },
    observed_facts: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of observed facts directly supported by the evidence',
    },
    hypotheses: {
      type: 'array',
      items: { type: 'string' },
      description: 'Plausible hypotheses explaining the activity',
    },
    unknowns: {
      type: 'array',
      items: { type: 'string' },
      description: 'Key unknowns, gaps in telemetry, or unresolved questions',
    },
    supporting_event_ids: {
      type: 'array',
      items: { type: 'string' },
      description: 'Exact event IDs from the provided evidence supporting the findings',
    },
    suggested_checks: {
      type: 'array',
      items: { type: 'string' },
      description: 'Advisory, read-only follow-up investigation checks',
    },
    client_summary_draft: {
      type: 'string',
      description: 'Client-facing investigation draft summarizing confirmed observations and caveats',
    },
    limitations: {
      type: 'array',
      items: { type: 'string' },
      description: 'Material caveats, limitations, and scope boundaries of the dataset',
    },
  },
  required: [
    'summary',
    'observed_facts',
    'hypotheses',
    'unknowns',
    'supporting_event_ids',
    'suggested_checks',
    'client_summary_draft',
    'limitations',
  ],
  additionalProperties: false,
};

/**
 * Strict schema for Google Gemini REST API (generationConfig.responseSchema).
 */
export const GEMINI_INVESTIGATION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    observed_facts: { type: 'ARRAY', items: { type: 'STRING' } },
    hypotheses: { type: 'ARRAY', items: { type: 'STRING' } },
    unknowns: { type: 'ARRAY', items: { type: 'STRING' } },
    supporting_event_ids: { type: 'ARRAY', items: { type: 'STRING' } },
    suggested_checks: { type: 'ARRAY', items: { type: 'STRING' } },
    client_summary_draft: { type: 'STRING' },
    limitations: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: [
    'summary',
    'observed_facts',
    'hypotheses',
    'unknowns',
    'supporting_event_ids',
    'suggested_checks',
    'client_summary_draft',
    'limitations',
  ],
};

const validateSchemaCompiled = ajv.compile(AI_INVESTIGATION_JSON_SCHEMA);

export interface ValidationSuccess {
  valid: true;
  data: AiInvestigationResponse;
}

export interface ValidationFailure {
  valid: false;
  code: 'MALFORMED_JSON' | 'SCHEMA_VALIDATION_FAILED' | 'INVALID_CITATIONS';
  error: string;
  details?: string[];
}

export type AiValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validates raw JSON text against schema and strict citation allowlist.
 */
export function validateAndVerifyAiResponse(
  rawJsonOrObject: string | unknown,
  allowlistEventIds: Set<string>
): AiValidationResult {
  let parsed: unknown;

  // 1. Parse JSON if string
  if (typeof rawJsonOrObject === 'string') {
    try {
      // Robustly strip potential markdown code fences if provider returned ```json ... ```
      let cleaned = rawJsonOrObject.trim();
      const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (codeBlockMatch) {
        cleaned = codeBlockMatch[1].trim();
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/i, '').replace(/\s*```$/i, '').trim();
      }
      parsed = JSON.parse(cleaned);
    } catch (err: any) {
      return {
        valid: false,
        code: 'MALFORMED_JSON',
        error: 'AI provider returned invalid JSON that could not be parsed.',
        details: [err.message],
      };
    }
  } else {
    parsed = rawJsonOrObject;
  }

  // 2. Validate against JSON schema
  const isSchemaValid = validateSchemaCompiled(parsed);
  if (!isSchemaValid) {
    const details = (validateSchemaCompiled.errors || []).map(
      (e: any) => `${e.instancePath || 'root'} ${e.message}`
    );
    return {
      valid: false,
      code: 'SCHEMA_VALIDATION_FAILED',
      error: 'AI response failed schema validation.',
      details,
    };
  }

  const typedData = parsed as AiInvestigationResponse;

  // 3. Strict Citation Validation against Allowlist
  const invalidCitations: string[] = [];
  for (const eventId of typedData.supporting_event_ids) {
    if (!allowlistEventIds.has(eventId)) {
      invalidCitations.push(eventId);
    }
  }

  if (invalidCitations.length > 0) {
    return {
      valid: false,
      code: 'INVALID_CITATIONS',
      error: `AI response cited event IDs that are not present in the authorized evidence set: ${invalidCitations.join(', ')}`,
      details: invalidCitations,
    };
  }

  return {
    valid: true,
    data: typedData,
  };
}

