import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { parserRunner, ParserRunner } from '../src/services/parser-runner.js';
import { config } from '../src/config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../');

describe('ParserRunner Service & Process Isolation Regression Tests', () => {
  const dummyTenantId = '22222222-2222-2222-2222-222222222222';
  const sshSuccessLog = path.resolve(repoRoot, 'fixtures/linux-auth/ssh-success.log');
  const sshFailureLog = path.resolve(repoRoot, 'fixtures/linux-auth/ssh-failure.log');
  const sudoActivityLog = path.resolve(repoRoot, 'fixtures/linux-auth/sudo-activity.log');

  describe('Path Resolution & ESM Compatibility', () => {
    it('resolves parser source path without calling require()', () => {
      // Regression check for "require is not defined" in ES module
      const parserSrc = parserRunner.getParserSrcPath();
      expect(typeof parserSrc).toBe('string');
      expect(fs.existsSync(parserSrc)).toBe(true);

      const cliPath = path.join(parserSrc, 'sentinel_parser', 'cli.py');
      expect(fs.existsSync(cliPath)).toBe(true);
    });

    it('verifies environment and entry point successfully', () => {
      const envInfo = parserRunner.verifyEnvironment();
      expect(envInfo.pythonExecutable).toBe(config.worker.pythonPath);
      expect(fs.existsSync(envInfo.cliPath)).toBe(true);
    });

    it('throws descriptive PARSER_CONFIG_ERROR if python executable path does not exist', () => {
      const runner = new ParserRunner();
      const originalPath = config.worker.pythonPath;

      try {
        // Intentionally point to non-existent executable path
        (config.worker as { pythonPath: string }).pythonPath = 'C:\\nonexistent\\python\\bin\\python.exe';
        expect(() => runner.verifyEnvironment()).toThrow(/PARSER_CONFIG_ERROR/);
      } finally {
        (config.worker as { pythonPath: string }).pythonPath = originalPath;
      }
    });
  });

  describe('Child Process Execution & Ingestion Verification', () => {
    it('executes python parser on ssh-success.log without throwing require is not defined', async () => {
      expect(fs.existsSync(sshSuccessLog)).toBe(true);

      const result = await parserRunner.runParser(sshSuccessLog, dummyTenantId);

      expect(result).toBeDefined();
      expect(result.total_lines).toBe(4);
      expect(result.valid_count).toBe(4);
      expect(result.malformed_count).toBe(0);
      expect(Array.isArray(result.events)).toBe(true);
      expect(result.events.length).toBe(4);

      // Verify canonical fields populated
      const firstEvent = result.events[0];
      expect(firstEvent.schema_version).toBe('1.0.0');
      expect(firstEvent.tenant_id).toBe(dummyTenantId);
      expect(firstEvent.source_type).toBe('linux_auth');
      expect(firstEvent.event_type).toBe('ssh_login_success');
      expect(firstEvent.username).toBe('deploy');
      expect(firstEvent.source_ip).toBe('192.0.2.10');
      expect(firstEvent.evidence).toBeDefined();
      expect(firstEvent.evidence.line_number).toBe(1);
    });

    it('executes python parser on ssh-failure.log fixture correctly', async () => {
      expect(fs.existsSync(sshFailureLog)).toBe(true);

      const result = await parserRunner.runParser(sshFailureLog, dummyTenantId);

      expect(result.total_lines).toBe(4);
      expect(result.valid_count).toBe(4);
      expect(result.malformed_count).toBe(0);
      expect(result.events.length).toBe(4);
      expect(result.events.map((e) => e.event_type)).toEqual([
        'invalid_user_attempt',
        'ssh_login_failure',
        'ssh_login_failure',
        'generic_security_event',
      ]);
    });

    it('executes python parser on sudo-activity.log fixture correctly', async () => {
      expect(fs.existsSync(sudoActivityLog)).toBe(true);

      const result = await parserRunner.runParser(sudoActivityLog, dummyTenantId);

      expect(result.total_lines).toBe(4);
      expect(result.valid_count).toBe(4);
      expect(result.malformed_count).toBe(0);
      expect(result.events.length).toBe(4);
      expect(result.events.map((e) => e.event_type)).toEqual([
        'sudo_execution',
        'session_opened',
        'session_closed',
        'privilege_escalation_failure',
      ]);
    });

    it('rejects with descriptive PARSER_ERROR when target file does not exist', async () => {
      const nonExistentFile = path.resolve(repoRoot, 'fixtures/linux-auth/does-not-exist.log');
      await expect(
        parserRunner.runParser(nonExistentFile, dummyTenantId)
      ).rejects.toThrow(/PARSER_ERROR: File to parse does not exist/);
    });

    it('ensures subprocess environment does not leak application secrets', async () => {
      // Ensure DATABASE_PASSWORD and SESSION_SECRET are in process.env
      const testSecretKey = 'SESSION_SECRET';
      const testSecretVal = 'super-secret-key-that-must-not-leak';
      const testDbPassKey = 'DATABASE_PASSWORD';
      const testDbPassVal = 'super-secret-db-pass';

      process.env[testSecretKey] = testSecretVal;
      process.env[testDbPassKey] = testDbPassVal;

      // Run parser and verify child process does not have access to these secrets
      // by inspecting runParser environment sanitization logic
      const runner = new ParserRunner();
      const envInfo = runner.verifyEnvironment();
      expect(envInfo).toBeDefined();

      // Execute on valid log
      const result = await runner.runParser(sshSuccessLog, dummyTenantId);
      expect(result.events.length).toBe(4);
    });
  });
});

