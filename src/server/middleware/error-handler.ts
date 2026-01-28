/**
 * Centralized Express error-handling middleware.
 *
 * Catches errors thrown or passed via `next(err)` in route handlers
 * and returns a consistent JSON error response.
 */

import type { Request, Response, NextFunction } from "express";

export interface ApiError extends Error {
  status?: number;
}

/**
 * Express error-handling middleware.
 * Must have 4 parameters so Express recognises it as an error handler.
 */
export function errorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = err.status ?? 500;
  const message = err.message || "Internal server error";

  res.status(status).json({ error: message });
}

/**
 * Create an ApiError with a specific HTTP status code.
 */
export function createApiError(status: number, message: string): ApiError {
  const err: ApiError = new Error(message);
  err.status = status;
  return err;
}
