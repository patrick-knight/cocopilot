/**
 * Configuration routes.
 *
 * GET  /api/v1/config  -- Return current global config
 * PATCH /api/v1/config -- Partially update global config
 */

import { Router } from "express";
import type { StateManager } from "../../state/index.js";

export function configRoutes(stateManager: StateManager): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(stateManager.getConfig());
  });

  router.patch("/", async (req, res) => {
    const patch = req.body;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      res.status(400).json({ error: "Request body must be a JSON object" });
      return;
    }
    const updated = await stateManager.updateConfig(patch);
    res.json(updated);
  });

  return router;
}
