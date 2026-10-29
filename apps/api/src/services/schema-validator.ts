import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv2020Class: any = (Ajv2020Module as any).default || Ajv2020Module;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addFormatsFn: any = (addFormatsModule as any).default || addFormatsModule;

const ajv = new Ajv2020Class({ allErrors: true, strict: false });
addFormatsFn(ajv);

// Locate schema
const potentialPaths = [
  path.resolve(__dirname, '../../../../database/schema/security-event.schema.json'),
  path.resolve(process.cwd(), 'database/schema/security-event.schema.json'),
  path.resolve(process.cwd(), '../../database/schema/security-event.schema.json'),
];

const schemaPath = potentialPaths.find((p) => fs.existsSync(p));
if (!schemaPath) {
  throw new Error(`Security event schema not found in: ${potentialPaths.join(', ')}`);
}

const rawSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
const compiledValidator = ajv.compile(rawSchema);

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export function validateSecurityEvent(data: unknown): ValidationResult {
  const valid = compiledValidator(data);
  if (valid) {
    return { valid: true };
  }
  const errors = (compiledValidator.errors || []).map((err: { instancePath?: string; message?: string }) => {
    return `${err.instancePath || 'root'} ${err.message || 'invalid'}`;
  });
  return { valid: false, errors };
}

