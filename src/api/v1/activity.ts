/**
 * Activity API — timeline of all activity events.
 *
 * GET  /api/v1/activity         — List activity events
 * GET  /api/v1/activity/export  — Export events as JSON or CSV
 */

import { Router } from "express";
import type { EventStore, ActivityEvent, EventFilter } from "../../state/event-store.js";

export interface ActivityDeps {
  eventStore?: EventStore;
}

export function activityRoutes(deps: ActivityDeps): Router {
  const router = Router();
  const { eventStore } = deps;

  // GET / — List activity events
  router.get("/", (req, res) => {
    if (!eventStore) {
      // Return empty array if no event store
      res.json({ events: [] });
      return;
    }

    const filter: EventFilter = {};
    if (typeof req.query.type === "string") filter.type = req.query.type;
    if (typeof req.query.agent === "string") filter.agent = req.query.agent;
    if (typeof req.query.repository === "string") filter.repository = req.query.repository;
    if (typeof req.query.from === "string") filter.from = req.query.from;
    if (typeof req.query.to === "string") filter.to = req.query.to;

    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 100;
    const events = eventStore.query(filter).slice(0, limit);
    res.json(events);
  });

  // GET /export — Export events as JSON or CSV
  router.get("/export", (req, res) => {
    if (!eventStore) {
      res.status(404).json({ error: "Event store not available" });
      return;
    }

    const format = req.query.format === "csv" ? "csv" : "json";
    const filter: EventFilter = {};
    if (typeof req.query.type === "string") filter.type = req.query.type;
    if (typeof req.query.agent === "string") filter.agent = req.query.agent;
    if (typeof req.query.repository === "string") filter.repository = req.query.repository;
    if (typeof req.query.from === "string") filter.from = req.query.from;
    if (typeof req.query.to === "string") filter.to = req.query.to;

    const events = eventStore.query(filter);

    if (format === "csv") {
      const header = "id,type,repository,description,timestamp,agent,prNumber,workerName";
      const rows = events.map((e) =>
        [
          e.id,
          e.type,
          e.repository,
          `"${(e.description || "").replace(/"/g, '""')}"`,
          e.timestamp,
          e.agent || "",
          e.prNumber?.toString() || "",
          e.workerName || "",
        ].join(",")
      );
      const csv = [header, ...rows].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="activity-${Date.now()}.csv"`);
      res.send(csv);
    } else {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="activity-${Date.now()}.json"`);
      res.json(events);
    }
  });

  return router;
}
