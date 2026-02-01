/**
 * Centralized agent naming for CoCoPilot.
 *
 * All agents MUST use scopedAgentName() / scopedWorkerName() for their
 * broker subscription and state registration. This prevents name
 * collisions when multiple repositories are tracked simultaneously.
 *
 * Pattern: "agentType:repoName"
 *   scopedAgentName("temperer", "my-app")  => "temperer:my-app"
 *   scopedWorkerName("Snickers", "my-app") => "Snickers:my-app"
 */

/**
 * Build a repo-scoped agent name: "type:repoName".
 *
 * Every agent that subscribes to the message broker must use this
 * function (or {@link scopedWorkerName} for Truffle workers) to
 * generate its subscription identity. Using a bare, unscoped name
 * will trigger a runtime warning from the broker.
 */
export function scopedAgentName(
  type: string,
  repoName: string,
): string {
  if (!repoName || repoName.trim() === "") {
    throw new Error(
      `scopedAgentName: repoName is required (got "${repoName}" for type "${type}")`,
    );
  }
  return `${type}:${repoName}`;
}

/**
 * Build a repo-scoped worker name: "workerName:repoName".
 *
 * Truffle workers use their candy name (e.g. "Snickers") for display
 * and state keys, but subscribe to the broker with the scoped form
 * to avoid collisions across repositories.
 */
export function scopedWorkerName(
  workerName: string,
  repoName: string,
): string {
  if (!repoName || repoName.trim() === "") {
    throw new Error(
      `scopedWorkerName: repoName is required (got "${repoName}" for worker "${workerName}")`,
    );
  }
  return `${workerName}:${repoName}`;
}

/**
 * Check whether a name follows the scoped "x:y" pattern.
 * Used by the broker for runtime validation.
 */
export function isScopedName(name: string): boolean {
  return name.includes(":");
}
