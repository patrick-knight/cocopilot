/**
 * File-Based Message Persistence
 *
 * Provides durable message storage on disk as a complement to Redis pub/sub.
 * Messages are persisted as individual JSON files in an agent-specific
 * directory. This allows recovery of unacknowledged messages after crashes
 * or daemon restarts.
 *
 * Directory structure:
 *   <basePath>/
 *     <agentName>/
 *       <messageId>.json       — pending message
 *       <messageId>.ack.json   — acknowledged message
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CocoMessage } from "./types.js";

export interface FileStoreConfig {
  /** Base directory for message files. */
  basePath: string;
}

/**
 * FileMessageStore persists CoCoPilot messages to the filesystem
 * for durability and recovery.
 */
export class FileMessageStore {
  private readonly basePath: string;

  constructor(config: FileStoreConfig) {
    this.basePath = config.basePath;
  }

  /**
   * Save a message to disk. The message is written to the recipient's
   * directory (or a __broadcast__ directory for broadcasts).
   */
  async save(message: CocoMessage): Promise<void> {
    const dir = this.agentDir(message.to === "*" ? "__broadcast__" : message.to);
    await fs.promises.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, `${message.id}.json`);
    const tmpPath = `${filePath}.tmp`;

    // Atomic write: write to temp file, then rename
    await fs.promises.writeFile(tmpPath, JSON.stringify(message, null, 2), "utf-8");
    await fs.promises.rename(tmpPath, filePath);
  }

  /**
   * Acknowledge a message by renaming it from .json to .ack.json
   * and recording the acknowledgment timestamp.
   */
  async acknowledge(agentName: string, messageId: string): Promise<boolean> {
    const dir = this.agentDir(agentName);
    const srcPath = path.join(dir, `${messageId}.json`);
    const ackPath = path.join(dir, `${messageId}.ack.json`);

    try {
      // Read, update ack timestamp, write ack file
      const raw = await fs.promises.readFile(srcPath, "utf-8");
      const message = JSON.parse(raw) as CocoMessage;
      message.ack_received = Date.now();

      const tmpPath = `${ackPath}.tmp`;
      await fs.promises.writeFile(tmpPath, JSON.stringify(message, null, 2), "utf-8");
      await fs.promises.rename(tmpPath, ackPath);

      // Remove the original pending file
      await fs.promises.unlink(srcPath).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all unacknowledged (pending) messages for an agent.
   * Used during recovery to replay messages that were not processed.
   */
  async getPending(agentName: string): Promise<CocoMessage[]> {
    const dir = this.agentDir(agentName);
    return this.readMessagesFromDir(dir, (file) =>
      file.endsWith(".json") && !file.endsWith(".ack.json") && !file.endsWith(".tmp"),
    );
  }

  /** Get all acknowledged messages for an agent. */
  async getAcknowledged(agentName: string): Promise<CocoMessage[]> {
    const dir = this.agentDir(agentName);
    return this.readMessagesFromDir(dir, (file) => file.endsWith(".ack.json"));
  }

  /** Get all messages (pending + acknowledged) for an agent. */
  async getAll(agentName: string): Promise<CocoMessage[]> {
    const dir = this.agentDir(agentName);
    return this.readMessagesFromDir(dir, (file) =>
      file.endsWith(".json") && !file.endsWith(".tmp"),
    );
  }

  /** Get pending broadcast messages. */
  async getPendingBroadcasts(): Promise<CocoMessage[]> {
    return this.getPending("__broadcast__");
  }

  /**
   * Delete acknowledged messages older than the given age in milliseconds.
   * Returns the number of files deleted.
   */
  async cleanup(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    let deleted = 0;

    try {
      const agents = await fs.promises.readdir(this.basePath, { withFileTypes: true });
      for (const entry of agents) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(this.basePath, entry.name);
        const files = await fs.promises.readdir(dir);

        for (const file of files) {
          if (!file.endsWith(".ack.json")) continue;

          const filePath = path.join(dir, file);
          try {
            const raw = await fs.promises.readFile(filePath, "utf-8");
            const msg = JSON.parse(raw) as CocoMessage;
            if (msg.ack_received && msg.ack_received < cutoff) {
              await fs.promises.unlink(filePath);
              deleted++;
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // basePath doesn't exist yet — nothing to clean
    }

    return deleted;
  }

  /**
   * Delete a specific message file (pending or acknowledged).
   */
  async delete(agentName: string, messageId: string): Promise<boolean> {
    const dir = this.agentDir(agentName);
    const pending = path.join(dir, `${messageId}.json`);
    const acked = path.join(dir, `${messageId}.ack.json`);

    let deleted = false;
    try {
      await fs.promises.unlink(pending);
      deleted = true;
    } catch {
      // Not found as pending
    }
    try {
      await fs.promises.unlink(acked);
      deleted = true;
    } catch {
      // Not found as acknowledged
    }
    return deleted;
  }

  /**
   * Get recent messages across all agents, sorted by timestamp descending.
   * @param limit Maximum number of messages to return
   * @param repoName Optional filter by repository name
   */
  async getRecent(limit = 50, repoName?: string): Promise<CocoMessage[]> {
    const allMessages: CocoMessage[] = [];

    try {
      const agents = await fs.promises.readdir(this.basePath, { withFileTypes: true });
      for (const entry of agents) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(this.basePath, entry.name);
        const messages = await this.readMessagesFromDir(dir, (file) =>
          file.endsWith(".json") && !file.endsWith(".tmp"),
        );
        allMessages.push(...messages);
      }
    } catch {
      // basePath doesn't exist yet
    }

    // Filter by repo if specified
    let filtered = allMessages;
    if (repoName) {
      filtered = allMessages.filter((m) => {
        const payload = m.payload as { repoName?: string } | undefined;
        return payload?.repoName === repoName;
      });
    }

    // Sort by timestamp descending (newest first) and limit
    filtered.sort((a, b) => b.timestamp - a.timestamp);
    return filtered.slice(0, limit);
  }

  private agentDir(agentName: string): string {
    return path.join(this.basePath, agentName);
  }

  private async readMessagesFromDir(
    dir: string,
    filter: (filename: string) => boolean,
  ): Promise<CocoMessage[]> {
    try {
      const files = await fs.promises.readdir(dir);
      const messages: CocoMessage[] = [];

      for (const file of files) {
        if (!filter(file)) continue;
        try {
          const raw = await fs.promises.readFile(path.join(dir, file), "utf-8");
          messages.push(JSON.parse(raw) as CocoMessage);
        } catch {
          // Skip unreadable files
        }
      }

      // Sort by timestamp ascending (oldest first)
      messages.sort((a, b) => a.timestamp - b.timestamp);
      return messages;
    } catch {
      return [];
    }
  }
}
