import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface StorageService {
  saveFile(workspaceId: string, storageKey: string, content: Buffer | string): Promise<{ storageKey: string; absolutePath: string }>;
  getFilePath(workspaceId: string, storageKey: string): string;
  fileExists(workspaceId: string, storageKey: string): Promise<boolean>;
  getFileStream(workspaceId: string, storageKey: string): Promise<Readable>;
  deleteFile(workspaceId: string, storageKey: string): Promise<void>;
}

export class LocalStorageService implements StorageService {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || config.storage.baseDir;
    // Ensure base storage directory exists
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getWorkspaceDir(workspaceId: string): string {
    const safeWorkspaceId = path.basename(workspaceId.replace(/[^a-zA-Z0-9_-]/g, ''));
    const dir = path.join(this.baseDir, 'workspaces', safeWorkspaceId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  public getFilePath(workspaceId: string, storageKey: string): string {
    const workspaceDir = this.getWorkspaceDir(workspaceId);
    const safeKey = path.basename(storageKey.replace(/[^a-zA-Z0-9_-]/g, ''));
    const filePath = path.join(workspaceDir, `${safeKey}.log`);

    // Guard against path traversal
    if (!filePath.startsWith(workspaceDir)) {
      throw new Error('Access denied: Invalid storage key traversal attempt');
    }

    return filePath;
  }

  public async saveFile(
    workspaceId: string,
    storageKey: string,
    content: Buffer | string
  ): Promise<{ storageKey: string; absolutePath: string }> {
    const filePath = this.getFilePath(workspaceId, storageKey);
    await fs.promises.writeFile(filePath, content);
    return { storageKey, absolutePath: filePath };
  }

  public async fileExists(workspaceId: string, storageKey: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(workspaceId, storageKey);
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  public async getFileStream(workspaceId: string, storageKey: string): Promise<Readable> {
    const filePath = this.getFilePath(workspaceId, storageKey);
    const exists = await this.fileExists(workspaceId, storageKey);
    if (!exists) {
      throw new Error('File not found in storage');
    }
    return fs.createReadStream(filePath);
  }

  public async deleteFile(workspaceId: string, storageKey: string): Promise<void> {
    try {
      const filePath = this.getFilePath(workspaceId, storageKey);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (err) {
      logger.error({ err, workspaceId, storageKey }, 'Failed to delete file from storage');
    }
  }
}

export const storageService = new LocalStorageService();

