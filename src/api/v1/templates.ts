/**
 * Task templates API — reusable task presets for worker spawning.
 *
 * GET /api/v1/templates         — List all templates (built-in + repo-specific)
 * GET /api/v1/templates/:id     — Get a specific template by ID
 */

import { Router } from "express";
import type { StateManager } from "../../state/index.js";
import type { TaskTemplate } from "../../state/schemas.js";
import { createApiError } from "../../server/middleware/error-handler.js";
import { loadRepoConfig } from "../../utils/index.js";

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

export const BUILTIN_TEMPLATES: TaskTemplate[] = [
  {
    id: "add-tests",
    name: "Add Tests",
    description: "Add comprehensive unit tests",
    task: "Add comprehensive unit tests for untested modules. Focus on edge cases and error paths. Aim for >80% coverage.",
    category: "testing",
  },
  {
    id: "fix-lint",
    name: "Fix Lint Issues",
    description: "Fix all linting errors",
    task: "Fix all linting errors and warnings. Run the project's lint command and resolve every issue. Do not disable rules.",
    category: "quality",
  },
  {
    id: "update-deps",
    name: "Update Dependencies",
    description: "Update outdated dependencies",
    task: "Update all outdated dependencies to their latest compatible versions. Run tests after each update to ensure nothing breaks.",
    category: "maintenance",
  },
  {
    id: "add-docs",
    name: "Add Documentation",
    description: "Add missing documentation",
    task: "Add comprehensive JSDoc/TSDoc comments to all public APIs. Update README if needed. Add usage examples.",
    category: "documentation",
  },
  {
    id: "security-audit",
    name: "Security Audit",
    description: "Fix security vulnerabilities",
    task: "Run security audit (npm audit / similar). Fix all high and critical vulnerabilities. Document any that cannot be fixed.",
    category: "security",
  },
  {
    id: "refactor",
    name: "Refactor Module",
    description: "Refactor for maintainability",
    task: "Refactor the specified module for better maintainability. Extract functions, reduce complexity, improve naming. Keep all tests passing.",
    category: "quality",
  },
  {
    id: "add-types",
    name: "Add Type Safety",
    description: "Improve TypeScript types",
    task: "Replace all 'any' types with proper TypeScript types. Add missing type annotations. Fix type errors.",
    category: "quality",
  },
  {
    id: "perf-optimize",
    name: "Performance Optimization",
    description: "Optimize performance bottlenecks",
    task: "Profile and optimize performance bottlenecks. Focus on hot paths, reduce unnecessary allocations, improve algorithmic complexity where possible.",
    category: "performance",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a template by ID from built-in templates and optional repo-specific templates.
 */
export function resolveTemplate(
  templateId: string,
  repoTemplates?: TaskTemplate[],
): TaskTemplate | undefined {
  // Repo-specific templates take priority over built-in ones
  const repoMatch = repoTemplates?.find((t) => t.id === templateId);
  if (repoMatch) return repoMatch;
  return BUILTIN_TEMPLATES.find((t) => t.id === templateId);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface TemplatesDeps {
  stateManager: StateManager;
}

export function templatesRoutes(deps: TemplatesDeps): Router {
  const { stateManager } = deps;
  const router = Router();

  // GET / — List all templates (built-in + repo-specific when ?repo= is provided)
  router.get("/", (req, res) => {
    const repoName = req.query.repo as string | undefined;

    let repoTemplates: TaskTemplate[] = [];
    if (repoName) {
      const repo = stateManager.getRepo(repoName);
      if (repo) {
        const repoConfig = loadRepoConfig(repo.localPath);
        repoTemplates = repoConfig.templates ?? [];
      }
    }

    // Combine: repo-specific first, then built-in (no duplicates by id)
    const seenIds = new Set<string>();
    const templates: TaskTemplate[] = [];

    for (const t of repoTemplates) {
      if (!seenIds.has(t.id)) {
        seenIds.add(t.id);
        templates.push({ ...t, source: "repo" });
      }
    }
    for (const t of BUILTIN_TEMPLATES) {
      if (!seenIds.has(t.id)) {
        seenIds.add(t.id);
        templates.push({ ...t, source: "builtin" });
      }
    }

    res.json({ templates });
  });

  // GET /:id — Get a specific template
  router.get("/:id", (req, res, next) => {
    const { id } = req.params;
    const repoName = req.query.repo as string | undefined;

    let repoTemplates: TaskTemplate[] = [];
    if (repoName) {
      const repo = stateManager.getRepo(repoName);
      if (repo) {
        const repoConfig = loadRepoConfig(repo.localPath);
        repoTemplates = repoConfig.templates ?? [];
      }
    }

    const template = resolveTemplate(id, repoTemplates);
    if (!template) {
      next(createApiError(404, `Template "${id}" not found`));
      return;
    }

    res.json(template);
  });

  return router;
}
