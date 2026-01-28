/**
 * Activity events route.
 *
 * GET /api/v1/events — List activity events with optional filters.
 *
 * Query parameters:
 *   type       — Filter by event type (e.g. "worker_spawned")
 *   agent      — Filter by agent name
 *   repository — Filter by repository name
 *   from       — ISO 8601 date/datetime lower bound (inclusive)
 *   to         — ISO 8601 date/datetime upper bound (inclusive day)
 */

import { Router } from "express";
import type { EventStore } from "../../state/index.js";

export function eventsRoutes(eventStore: EventStore): Router {
  const router = Router();

  // GET /events — List events with optional filters
  router.get("/", (_req, res) => {
    const { type, agent, repository, from, to } = _req.query;

    const events = eventStore.query({
      type: typeof type === "string" ? type : undefined,
      agent: typeof agent === "string" ? agent : undefined,
      repository: typeof repository === "string" ? repository : undefined,
      from: typeof from === "string" ? from : undefined,
      to: typeof to === "string" ? to : undefined,
    });

    res.json(events);
  });

  return router;
}
