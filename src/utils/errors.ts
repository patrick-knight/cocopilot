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
  return String(err);
}

/**
 * Wrap an error with additional context.
 */
export function wrapError(err: unknown, context: string): Error {
  const message = getErrorMessage(err);
  return new Error(`${context}: ${message}`);
}
