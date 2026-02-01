/**
 * Error handling utilities.
 */

/**
 * Extract a human-readable message from any error value.
 * Handles Error instances, strings, and unknown objects.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  if (err !== null && typeof err === "object") {
    const anyErr = err as { message?: unknown; name?: unknown };
    if (typeof anyErr.message === "string") {
      if (typeof anyErr.name === "string" && anyErr.name) {
        return `${anyErr.name}: ${anyErr.message}`;
      }
      return anyErr.message;
    }
  }
  return String(err);
}

/**
 * Wrap an error with additional context.
 */
export function wrapError(err: unknown, context: string): Error {
  const message = getErrorMessage(err);
  return new Error(`${context}: ${message}`);
}
