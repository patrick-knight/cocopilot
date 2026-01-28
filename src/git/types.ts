/**
 * Git Worktree Types
 *
 * Type definitions for CoCoPilot's git worktree management.
 * Worktrees are the "Truffle Boxes" that give each agent an isolated
 * working directory on its own branch.
 */

/** Parsed information about a single git worktree. */
export interface WorktreeInfo {
  /** Absolute path to the worktree directory. */
  path: string;
  /** HEAD commit SHA. */
  head: string;
  /** Branch ref (e.g., "refs/heads/work/Snickers"), or undefined if detached. */
  branch?: string;
  /** Whether this is the bare/main worktree. */
  bare: boolean;
  /** Whether the worktree directory is missing and can be pruned. */
  prunable: boolean;
  /** Whether HEAD is detached. */
  detached: boolean;
}
