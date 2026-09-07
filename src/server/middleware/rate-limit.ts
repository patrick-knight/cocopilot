import type { NextFunction, Request, Response } from "express";

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
}

/**
 * Apply a small in-memory request limit to an expensive route.
 *
 * This is intentionally local to a process: the protected endpoints are
 * daemon-local and the limit is a safeguard against bursts, not a substitute
 * for an external distributed limiter.
 */
export function createRateLimiter(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 60;
  const clients = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    let entry = clients.get(key);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      clients.set(key, entry);
    }

    entry.count++;
    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", Math.max(0, max - entry.count));
    res.setHeader("RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    // Prune expired entries opportunistically, then evict oldest entries to cap memory.
    if (clients.size > 10_000) {
      for (const [clientKey, client] of clients) {
        if (now >= client.resetAt) clients.delete(clientKey);
      }
      while (clients.size > 10_000) {
        const oldestKey = clients.keys().next().value as string | undefined;
        if (!oldestKey) break;
        clients.delete(oldestKey);
      }
    }

    next();
  };
}
