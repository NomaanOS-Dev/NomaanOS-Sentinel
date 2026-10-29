import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env from root or current directory
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config(); // fallback to local directory

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
}

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password?: string;
    url: string;
  };
  logLevel: string;
  parser: {
    maxFileBytes: number;
    maxLines: number;
  };
  auth: {
    sessionSecret: string;
    sessionCookieName: string;
    sessionExpirationDays: number;
  };
  email: {
    provider: 'development' | 'smtp' | string;
    from: string;
    webUrl: string;
    smtp?: SmtpConfig;
  };
  storage: {
    baseDir: string;
  };
  upload: {
    maxFileBytes: number;
    maxLines: number;
    maxLineLengthBytes: number;
    processingTimeoutMs: number;
    allowedExtensions: string[];
  };
  worker: {
    pythonPath: string;
    pollIntervalMs: number;
    leaseDurationSeconds: number;
    maxJobAttempts: number;
  };
  ai: {
    provider: string;
    apiKey?: string;
    model: string;
    timeoutMs: number;
    rateLimitPerMinute: number;
  };
  enrollment: {
    tokenExpirationMinutes: number;
  };
  razorpay: {
    keyId?: string;
    keySecret?: string;
    webhookSecret?: string;
    isTestMode: boolean;
  };
  outboundWebhooks: {
    timeoutMs: number;
    maxRetries: number;
    allowInsecureHttp: boolean;
  };
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const port = parseInt(process.env.API_PORT || '4000', 10);
  const dbHost = process.env.DATABASE_HOST || 'localhost';
  const dbPort = parseInt(process.env.DATABASE_PORT || '5433', 10);
  const dbName = process.env.DATABASE_NAME || 'nomaanos_sentinel';
  const dbUser = process.env.DATABASE_USER || 'sentinel_dev';
  const dbPassword = process.env.DATABASE_PASSWORD;
  const dbUrl = process.env.DATABASE_URL || `postgresql://${dbUser}:${dbPassword || ''}@${dbHost}:${dbPort}/${dbName}`;
  const logLevel = process.env.LOG_LEVEL || (nodeEnv === 'production' ? 'info' : 'debug');
  const maxFileBytes = parseInt(process.env.PARSER_MAX_FILE_BYTES || '10485760', 10);
  const maxLines = parseInt(process.env.PARSER_MAX_LINES || '50000', 10);

  const sessionSecret = process.env.SESSION_SECRET || 'sentinel_dev_session_secret_default_change_in_prod';
  const sessionCookieName = process.env.SESSION_COOKIE_NAME || 'sentinel_session';
  const sessionExpirationDays = parseInt(process.env.SESSION_EXPIRATION_DAYS || '7', 10);

  const emailProvider = (process.env.EMAIL_PROVIDER || 'development').toLowerCase();
  const emailFrom = process.env.EMAIL_FROM || 'noreply@sentinel.local';
  const webUrl = process.env.WEB_URL || 'http://localhost:3000';

  const smtpHost = process.env.SMTP_HOST;
  const smtpPortRaw = process.env.SMTP_PORT;
  const smtpPort = smtpPortRaw ? parseInt(smtpPortRaw, 10) : 2525;
  const smtpUser = process.env.SMTP_USER || process.env.SMTP_USERNAME;
  const smtpPass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS;
  const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;

  let smtpConfig: SmtpConfig | undefined = undefined;
  if (emailProvider === 'smtp') {
    if (!smtpHost) {
      throw new Error('SMTP_HOST must be configured when EMAIL_PROVIDER is set to "smtp".');
    }
    if (isNaN(smtpPort) || smtpPort <= 0 || smtpPort > 65535) {
      throw new Error(`Invalid SMTP_PORT: "${smtpPortRaw}". Port must be an integer between 1 and 65535.`);
    }
    if (nodeEnv === 'production' && (!smtpUser || !smtpPass)) {
      throw new Error('SMTP_USER and SMTP_PASSWORD must be configured in production when EMAIL_PROVIDER is "smtp".');
    }
    smtpConfig = {
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
    };
  } else if (smtpHost) {
    smtpConfig = {
      host: smtpHost,
      port: isNaN(smtpPort) ? 2525 : smtpPort,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
    };
  }

  const storageBaseDir = process.env.STORAGE_DIR 
    ? path.resolve(process.env.STORAGE_DIR)
    : path.resolve(process.cwd(), 'storage');

  const uploadMaxFileBytes = parseInt(process.env.UPLOAD_MAX_FILE_BYTES || '5242880', 10); // 5 MiB
  const uploadMaxLines = parseInt(process.env.UPLOAD_MAX_LINES || '50000', 10);
  const uploadMaxLineLengthBytes = parseInt(process.env.UPLOAD_MAX_LINE_LENGTH_BYTES || '16384', 10); // 16 KiB
  const uploadProcessingTimeoutMs = parseInt(process.env.UPLOAD_PROCESSING_TIMEOUT_MS || '30000', 10); // 30s
  const allowedExtensions = ['.log', '.txt'];

  let pythonExecutable = process.env.PYTHON_PATH || 'python';
  const windowsLocalPython = 'C:\\Users\\NK-WorkStation\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
  if (!process.env.PYTHON_PATH && fs.existsSync(windowsLocalPython)) {
    pythonExecutable = windowsLocalPython;
  }

  const workerPollIntervalMs = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '2000', 10);
  const workerLeaseSeconds = parseInt(process.env.WORKER_LEASE_SECONDS || '45', 10);
  const workerMaxAttempts = parseInt(process.env.WORKER_MAX_ATTEMPTS || '3', 10);

  if (nodeEnv === 'production' && !dbPassword) {
    throw new Error('DATABASE_PASSWORD must be configured in production environment.');
  }

  if (nodeEnv === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('default'))) {
    throw new Error('SESSION_SECRET must be configured with a strong secret in production environment.');
  }

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port,
    database: {
      host: dbHost,
      port: dbPort,
      name: dbName,
      user: dbUser,
      password: dbPassword,
      url: dbUrl,
    },
    logLevel,
    parser: {
      maxFileBytes,
      maxLines,
    },
    auth: {
      sessionSecret,
      sessionCookieName,
      sessionExpirationDays,
    },
    email: {
      provider: emailProvider,
      from: emailFrom,
      webUrl,
      smtp: smtpConfig,
    },
    storage: {
      baseDir: storageBaseDir,
    },
    upload: {
      maxFileBytes: uploadMaxFileBytes,
      maxLines: uploadMaxLines,
      maxLineLengthBytes: uploadMaxLineLengthBytes,
      processingTimeoutMs: uploadProcessingTimeoutMs,
      allowedExtensions,
    },
    worker: {
      pythonPath: pythonExecutable,
      pollIntervalMs: workerPollIntervalMs,
      leaseDurationSeconds: workerLeaseSeconds,
      maxJobAttempts: workerMaxAttempts,
    },
    ai: {
      provider: process.env.AI_PROVIDER || (nodeEnv === 'test' ? 'mock' : 'none'),
      apiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY,
      model: process.env.AI_MODEL || ((process.env.AI_PROVIDER === 'openai') ? 'gpt-4o-mini' : 'gemini-1.5-pro'),
      timeoutMs: parseInt(process.env.AI_TIMEOUT_MS || '30000', 10),
      rateLimitPerMinute: parseInt(process.env.AI_RATE_LIMIT_PER_MINUTE || '10', 10),
    },
    enrollment: {
      tokenExpirationMinutes: parseInt(process.env.ENROLLMENT_TOKEN_EXPIRATION_MINUTES || '15', 10),
    },
    razorpay: {
      keyId: process.env.RAZORPAY_KEY_ID,
      keySecret: process.env.RAZORPAY_KEY_SECRET,
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
      isTestMode: (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') ?? true) || nodeEnv !== 'production',
    },
    outboundWebhooks: {
      timeoutMs: parseInt(process.env.OUTBOUND_WEBHOOK_TIMEOUT_MS || '5000', 10),
      maxRetries: parseInt(process.env.OUTBOUND_WEBHOOK_MAX_RETRIES || '3', 10),
      allowInsecureHttp: process.env.OUTBOUND_WEBHOOK_ALLOW_INSECURE_HTTP === 'true',
    },
  };
}

export const config = loadConfig();

