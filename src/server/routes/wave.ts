/**
 * Wave audit API routes.
 *
 * POST /api/v1/repositories/:repoName/wave/audit — Trigger a wave audit
 * GET  /api/v1/repositories/:repoName/wave/reports — List audit reports
 * GET  /api/v1/repositories/:repoName/wave/reports/:id — Get a specific report
 */

import { Router } from "express";
import type { StateManager } from "../../state/index.js";
import { WaveAuditor } from "../../wave/index.js";
import type { ScanKind, WaveAuditReport } from "../../wave/index.js";

interface RepoParams {
  repoName: string;
  [key: string]: string;
}

interface ReportParams extends RepoParams {
  id: string;
}

const VALID_SCANNERS: ScanKind[] = ["npm-audit", "trivy", "codeql", "gitleaks"];

/**
 * Factory that creates wave audit routes.
 * Reports are stored in memory; a production system would persist them.
 */
export function waveRoutes(stateManager: StateManager): Router {
  const router = Router({ mergeParams: true });
  const auditor = new WaveAuditor();
  const reports = new Map<string, WaveAuditReport>();

  // POST /audit — trigger a new audit
  router.post("/audit", async (req, res) => {
    const { repoName } = req.params as unknown as RepoParams;
    const repos = stateManager.getRepos();
    const repo = repos[repoName];

    if (!repo) {
      res.status(404).json({ error: `Repository "${repoName}" not found.` });
      return;
    }

    const {
      waveId,
      scanners,
      runE2E,
      dockerImage,
    } = req.body as {
      waveId?: string;
      scanners?: string[];
      runE2E?: boolean;
      dockerImage?: string;
    };

    // Validate scanners if provided
    if (scanners) {
      const invalid = scanners.filter(
        (s) => !VALID_SCANNERS.includes(s as ScanKind),
      );
      if (invalid.length > 0) {
        res.status(400).json({
          error: `Invalid scanner(s): ${invalid.join(", ")}. Valid: ${VALID_SCANNERS.join(", ")}`,
        });
        return;
      }
    }

    try {
      const report = await auditor.audit({
        repoName,
        repoPath: repo.localPath,
        waveId,
        scanners: scanners as ScanKind[] | undefined,
        runE2E,
        dockerImage,
      });

      reports.set(report.id, report);

      res.status(201).json(report);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Audit failed: ${message}` });
    }
  });

  // GET /reports — list all reports for this repo
  router.get("/reports", (_req, res) => {
    const { repoName } = _req.params as unknown as RepoParams;
    const repoReports = Array.from(reports.values())
      .filter((r) => r.repoName === repoName)
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );

    res.json({
      reports: repoReports.map((r) => ({
        id: r.id,
        waveId: r.waveId,
        verdict: r.verdict,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        durationMs: r.durationMs,
        summary: r.summary,
      })),
    });
  });

  // GET /reports/:id — get a specific report
  router.get("/reports/:id", (req, res) => {
    const { id } = req.params as unknown as ReportParams;
    const report = reports.get(id);
    if (!report) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    res.json(report);
  });

  return router;
}
