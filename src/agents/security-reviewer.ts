/**
 * Security Reviewer Agent
 *
 * Operates between Truffle workers and the Temperer to ensure all code
 * is securely written before it can be merged. Reviews PRs for security
 * vulnerabilities and blocks merges when critical issues are found.
 *
 * Message Flow:
 *   1. Truffle creates PR → sends SECURITY_REVIEW_REQUEST
 *   2. SecurityReviewer analyzes diff
 *   3. SecurityReviewer sends SECURITY_REVIEW_PASSED or SECURITY_REVIEW_FAILED
 *   4. Temperer waits for PASSED before merging
 */

import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { MessageBroker, MessageType } from "../messaging/index.js";
import { scopedAgentName } from "./scoped-name.js";
import type { CocoMessage, SecurityReviewRequestPayload, SecurityIssue } from "../messaging/types.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecurityReviewerConfig {
  repoPath: string;
  /** The repository name (used for scoped agent naming). */
  repoName: string;
  agentName?: string;
  tempererName?: string;
}

export interface SecurityReviewerEvents {
  reviewStarted: [prNumber: number];
  issueFound: [issue: SecurityIssue];
  reviewPassed: [prNumber: number, warnings: string[]];
  reviewFailed: [prNumber: number, issues: SecurityIssue[]];
  error: [error: Error];
}

// ---------------------------------------------------------------------------
// Security patterns
// ---------------------------------------------------------------------------

interface SecurityPattern {
  pattern: RegExp;
  message: string;
  severity: SecurityIssue["severity"];
  cwe?: string;
}

const SECURITY_PATTERNS: SecurityPattern[] = [
  // Injection vulnerabilities
  { pattern: /eval\s*\(/gi, message: "Code injection via eval()", severity: "critical", cwe: "CWE-94" },
  { pattern: /new\s+Function\s*\(/gi, message: "Code injection via Function constructor", severity: "critical", cwe: "CWE-94" },
  { pattern: /exec\s*\(\s*[`'"]/gi, message: "Potential command injection", severity: "critical", cwe: "CWE-78" },
  { pattern: /execSync\s*\(/gi, message: "Synchronous command execution - check for injection", severity: "high", cwe: "CWE-78" },
  { pattern: /child_process.*exec/gi, message: "Command execution - ensure input sanitization", severity: "high", cwe: "CWE-78" },
  { pattern: /\$\{.*\}.*sql|sql.*\$\{/gi, message: "Potential SQL injection via template literal", severity: "critical", cwe: "CWE-89" },
  { pattern: /query\s*\(\s*['"`].*\+/gi, message: "String concatenation in SQL query", severity: "critical", cwe: "CWE-89" },

  // XSS vulnerabilities
  { pattern: /innerHTML\s*=/gi, message: "XSS risk via innerHTML assignment", severity: "high", cwe: "CWE-79" },
  { pattern: /outerHTML\s*=/gi, message: "XSS risk via outerHTML assignment", severity: "high", cwe: "CWE-79" },
  { pattern: /dangerouslySetInnerHTML/gi, message: "XSS risk via dangerouslySetInnerHTML", severity: "high", cwe: "CWE-79" },
  { pattern: /v-html\s*=/gi, message: "XSS risk via Vue v-html directive", severity: "high", cwe: "CWE-79" },
  { pattern: /document\.write\s*\(/gi, message: "XSS risk via document.write", severity: "high", cwe: "CWE-79" },

  // Secrets & credentials
  { pattern: /password\s*[:=]\s*['"`][^'"`]{4,}/gi, message: "Hardcoded password detected", severity: "critical", cwe: "CWE-798" },
  { pattern: /api[_-]?key\s*[:=]\s*['"`][^'"`]{8,}/gi, message: "Hardcoded API key detected", severity: "critical", cwe: "CWE-798" },
  { pattern: /secret\s*[:=]\s*['"`][^'"`]{8,}/gi, message: "Hardcoded secret detected", severity: "critical", cwe: "CWE-798" },
  { pattern: /token\s*[:=]\s*['"`][A-Za-z0-9_-]{20,}/gi, message: "Hardcoded token detected", severity: "critical", cwe: "CWE-798" },
  { pattern: /private[_-]?key\s*[:=]/gi, message: "Private key assignment detected", severity: "critical", cwe: "CWE-798" },
  { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/gi, message: "Private key in source code", severity: "critical", cwe: "CWE-798" },
  { pattern: /ghp_[A-Za-z0-9]{36}/g, message: "GitHub personal access token detected", severity: "critical", cwe: "CWE-798" },
  { pattern: /sk-[A-Za-z0-9]{48}/g, message: "OpenAI API key detected", severity: "critical", cwe: "CWE-798" },

  // Authentication issues
  { pattern: /jwt\.sign.*algorithm.*none/gi, message: "JWT with 'none' algorithm is insecure", severity: "critical", cwe: "CWE-327" },
  { pattern: /verify\s*[:=]\s*false/gi, message: "TLS/SSL verification disabled", severity: "high", cwe: "CWE-295" },
  { pattern: /rejectUnauthorized\s*:\s*false/gi, message: "TLS certificate verification disabled", severity: "high", cwe: "CWE-295" },

  // Cryptography issues
  { pattern: /createHash\s*\(\s*['"]md5['"]/gi, message: "MD5 is cryptographically weak", severity: "medium", cwe: "CWE-328" },
  { pattern: /createHash\s*\(\s*['"]sha1['"]/gi, message: "SHA1 is cryptographically weak for security", severity: "medium", cwe: "CWE-328" },
  { pattern: /Math\.random\s*\(/gi, message: "Math.random() is not cryptographically secure", severity: "medium", cwe: "CWE-338" },

  // Path traversal
  { pattern: /path\.join\s*\([^)]*req\./gi, message: "Potential path traversal with user input", severity: "high", cwe: "CWE-22" },
  { pattern: /\.\.\/|\.\.\\|%2e%2e/gi, message: "Path traversal pattern detected", severity: "high", cwe: "CWE-22" },

  // Insecure deserialization
  { pattern: /JSON\.parse\s*\(\s*req\./gi, message: "Parsing untrusted JSON - validate schema", severity: "medium", cwe: "CWE-502" },
  { pattern: /unserialize\s*\(/gi, message: "Potential insecure deserialization", severity: "high", cwe: "CWE-502" },
  { pattern: /pickle\.loads?\s*\(/gi, message: "Insecure deserialization with pickle", severity: "critical", cwe: "CWE-502" },

  // Information exposure
  { pattern: /console\.(log|debug|trace)\s*\(.*password/gi, message: "Password logged to console", severity: "high", cwe: "CWE-532" },
  { pattern: /console\.(log|debug|trace)\s*\(.*token/gi, message: "Token logged to console", severity: "high", cwe: "CWE-532" },
  { pattern: /console\.(log|debug|trace)\s*\(.*secret/gi, message: "Secret logged to console", severity: "high", cwe: "CWE-532" },
  { pattern: /stack\s*:\s*error\.stack/gi, message: "Stack trace exposure in response", severity: "medium", cwe: "CWE-209" },

  // CORS issues
  { pattern: /Access-Control-Allow-Origin.*\*/gi, message: "Wildcard CORS origin allows any domain", severity: "medium", cwe: "CWE-942" },
  { pattern: /cors\s*\(\s*\)/gi, message: "CORS enabled without configuration - review policy", severity: "low", cwe: "CWE-942" },

  // Input validation
  { pattern: /parseInt\s*\([^,)]+\)/gi, message: "parseInt without radix may have unexpected behavior", severity: "low" },
];

// ---------------------------------------------------------------------------
// SecurityReviewerAgent
// ---------------------------------------------------------------------------

export class SecurityReviewerAgent extends EventEmitter<SecurityReviewerEvents> {
  private readonly config: SecurityReviewerConfig;
  private readonly broker: MessageBroker;
  private _isRunning = false;

  constructor(config: SecurityReviewerConfig, broker: MessageBroker) {
    super();
    this.config = {
      agentName: scopedAgentName("security-reviewer", config.repoName),
      tempererName: scopedAgentName("temperer", config.repoName),
      ...config,
    };
    this.broker = broker;
  }

  get name(): string {
    return this.config.agentName ?? "security-reviewer";
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async start(): Promise<void> {
    await this.broker.subscribe(this.name, (msg) => this.handleMessage(msg));
    this._isRunning = true;
  }

  async stop(): Promise<void> {
    await this.broker.unsubscribe(this.name);
    this._isRunning = false;
  }

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  private async handleMessage(msg: CocoMessage): Promise<void> {
    if (msg.type === MessageType.SECURITY_REVIEW_REQUEST) {
      const payload = msg.payload as SecurityReviewRequestPayload;
      await this.reviewPR(payload.prNumber, payload.workerName);
    }
  }

  // -----------------------------------------------------------------------
  // Core review functionality
  // -----------------------------------------------------------------------

  /**
   * Review a pull request for security issues.
   */
  async reviewPR(prNumber: number, workerName: string): Promise<void> {
    this.emit("reviewStarted", prNumber);

    try {
      // Get the PR diff
      const diff = await this.getPRDiff(prNumber);

      // Analyze for security issues
      const issues = this.analyzeDiff(diff);

      // Separate blocking issues from warnings
      const blockingIssues = issues.filter(
        (i) => i.severity === "critical" || i.severity === "high"
      );
      const warnings = issues
        .filter((i) => i.severity === "medium" || i.severity === "low")
        .map((i) => `[${i.severity.toUpperCase()}] ${i.file}: ${i.description}`);

      // Emit events for each issue found
      for (const issue of issues) {
        this.emit("issueFound", issue);
      }

      // Send result message (to both temperer and worker)
      if (blockingIssues.length > 0) {
        await this.sendReviewFailed(prNumber, blockingIssues, workerName);
        this.emit("reviewFailed", prNumber, blockingIssues);
      } else {
        await this.sendReviewPassed(prNumber, warnings, workerName);
        this.emit("reviewPassed", prNumber, warnings);
      }
    } catch (error) {
      this.emit("error", error as Error);
      // On error, fail the review to be safe
      await this.sendReviewFailed(prNumber, [
        {
          severity: "critical",
          file: "unknown",
          description: `Security review failed: ${(error as Error).message}`,
        },
      ], workerName);
    }
  }

  /**
   * Get the diff for a pull request using gh CLI.
   */
  private async getPRDiff(prNumber: number): Promise<string> {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "diff", String(prNumber)],
      { cwd: this.config.repoPath, maxBuffer: 10 * 1024 * 1024 }
    );
    return stdout;
  }

  /**
   * Analyze a diff for security vulnerabilities.
   */
  private analyzeDiff(diff: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    const lines = diff.split("\n");

    let currentFile = "";
    let lineNumber = 0;

    for (const line of lines) {
      // Track file changes
      const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
      if (fileMatch) {
        currentFile = fileMatch[1];
        lineNumber = 0;
        continue;
      }

      // Track line numbers
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (hunkMatch) {
        lineNumber = parseInt(hunkMatch[1], 10) - 1;
        continue;
      }

      // Only check added lines
      if (line.startsWith("+") && !line.startsWith("+++")) {
        lineNumber++;
        const content = line.slice(1);

        // Skip test files for some patterns
        const isTestFile = currentFile.includes("test") || 
                          currentFile.includes("spec") ||
                          currentFile.includes("__tests__");

        for (const pattern of SECURITY_PATTERNS) {
          if (pattern.pattern.test(content)) {
            // Skip low severity issues in test files
            if (isTestFile && (pattern.severity === "low" || pattern.severity === "medium")) {
              continue;
            }

            issues.push({
              severity: pattern.severity,
              file: currentFile,
              line: lineNumber,
              description: pattern.message,
              cwe: pattern.cwe,
            });
          }
          // Reset regex lastIndex for global patterns
          pattern.pattern.lastIndex = 0;
        }
      } else if (line.startsWith(" ")) {
        lineNumber++;
      }
    }

    return issues;
  }

  // -----------------------------------------------------------------------
  // Message sending
  // -----------------------------------------------------------------------

  private async sendReviewPassed(prNumber: number, warnings: string[], workerName?: string): Promise<void> {
    // Send to temperer
    await this.broker.send({
      type: MessageType.SECURITY_REVIEW_PASSED,
      from: this.name,
      to: this.config.tempererName ?? "temperer",
      payload: { prNumber, warnings },
      priority: "high",
      ack_required: false,
    });

    // Also notify the worker that submitted the review
    if (workerName) {
      await this.broker.send({
        type: MessageType.SECURITY_REVIEW_PASSED,
        from: this.name,
        to: workerName,
        payload: { prNumber, warnings },
        priority: "high",
        ack_required: false,
      });
    }
  }

  private async sendReviewFailed(prNumber: number, issues: SecurityIssue[], workerName?: string): Promise<void> {
    // Send to temperer
    await this.broker.send({
      type: MessageType.SECURITY_REVIEW_FAILED,
      from: this.name,
      to: this.config.tempererName ?? "temperer",
      payload: { prNumber, issues },
      priority: "high",
      ack_required: false,
    });

    // Also notify the worker that submitted the review
    if (workerName) {
      await this.broker.send({
        type: MessageType.SECURITY_REVIEW_FAILED,
        from: this.name,
        to: workerName,
        payload: { prNumber, issues },
        priority: "high",
        ack_required: false,
      });
    }
  }
}
