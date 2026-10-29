import crypto from 'crypto';
import path from 'path';
import { config } from '../config/env.js';

export interface FileValidationSuccess {
  valid: true;
  sha256: string;
  totalLines: number;
  nonEmptyLines: number;
  sizeBytes: number;
  sanitizedFilename: string;
}

export interface FileValidationFailure {
  valid: false;
  errorCode: string;
  message: string;
}

export type FileValidationResult = FileValidationSuccess | FileValidationFailure;

export function sanitizeFilename(filename: string): string {
  // Strip directory paths (both forward and backward slashes)
  const baseName = path.basename(filename.replace(/\\/g, '/'));
  // Remove non-printable or dangerous characters, keeping letters, numbers, dots, dashes, underscores
  const cleanName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleanName.slice(0, 255) || 'unnamed.log';
}

export function validateLogFile(
  buffer: Buffer,
  originalFilename: string
): FileValidationResult {
  const sanitizedFilename = sanitizeFilename(originalFilename);
  const ext = path.extname(sanitizedFilename).toLowerCase();

  // 1. Extension check
  if (!config.upload.allowedExtensions.includes(ext)) {
    return {
      valid: false,
      errorCode: 'UNSUPPORTED_EXTENSION',
      message: `Unsupported file extension '${ext}'. Only ${config.upload.allowedExtensions.join(', ')} plain-text files are accepted.`,
    };
  }

  // 2. Empty check
  if (buffer.length === 0) {
    return {
      valid: false,
      errorCode: 'FILE_EMPTY',
      message: 'Uploaded file is empty (0 bytes).',
    };
  }

  // 3. Oversized check
  if (buffer.length > config.upload.maxFileBytes) {
    return {
      valid: false,
      errorCode: 'FILE_OVERSIZED',
      message: `File size (${buffer.length} bytes) exceeds maximum limit of ${config.upload.maxFileBytes} bytes (5 MiB).`,
    };
  }

  // 4. Null byte / Binary content check
  // Fast byte scan for null bytes (\0)
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0) {
      return {
        valid: false,
        errorCode: 'INVALID_ENCODING_OR_BINARY',
        message: 'Binary content or null byte detected. Only plain-text logs are permitted.',
      };
    }
  }

  // 5. UTF-8 decoding check
  let text: string;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    text = decoder.decode(buffer);
  } catch {
    return {
      valid: false,
      errorCode: 'INVALID_ENCODING_OR_BINARY',
      message: 'Invalid UTF-8 encoding detected. Files must be valid UTF-8 plain-text.',
    };
  }

  // 6. Whitespace-only check
  if (text.trim().length === 0) {
    return {
      valid: false,
      errorCode: 'FILE_EMPTY',
      message: 'Uploaded file contains only whitespace.',
    };
  }

  // 7. Line count and line length check
  const rawLines = text.split(/\r?\n/);
  let nonEmptyCount = 0;
  const maxLineLength = config.upload.maxLineLengthBytes;
  const maxLines = config.upload.maxLines;

  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx];
    // Check byte length of line
    const lineByteLength = Buffer.byteLength(line, 'utf-8');
    if (lineByteLength > maxLineLength) {
      return {
        valid: false,
        errorCode: 'LINE_OVERLONG',
        message: `Line ${idx + 1} exceeds maximum permitted length of ${maxLineLength} bytes (16 KiB).`,
      };
    }

    if (line.trim().length > 0) {
      nonEmptyCount++;
      if (nonEmptyCount > maxLines) {
        return {
          valid: false,
          errorCode: 'FILE_TOO_MANY_LINES',
          message: `File exceeds maximum limit of ${maxLines} non-empty log lines.`,
        };
      }
    }
  }

  if (nonEmptyCount === 0) {
    return {
      valid: false,
      errorCode: 'FILE_EMPTY',
      message: 'Uploaded file contains no non-empty log records.',
    };
  }

  // 8. Compute SHA-256 hash
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    valid: true,
    sha256,
    totalLines: rawLines.length,
    nonEmptyLines: nonEmptyCount,
    sizeBytes: buffer.length,
    sanitizedFilename,
  };
}

