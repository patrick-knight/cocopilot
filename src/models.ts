/**
 * Available AI models for CoCoPilot workers.
 *
 * Cost multipliers are relative to the default model (1x).
 */

export interface ModelOption {
  /** API identifier (lowercase, hyphenated) */
  value: string;
  /** Human-readable display name */
  label: string;
  /** Cost multiplier relative to default (1x) */
  costMultiplier: number;
  /** Whether this is the default model */
  isDefault?: boolean;
}

/**
 * All available models for workers.
 * Sorted by provider, then by capability.
 */
export const AVAILABLE_MODELS: ModelOption[] = [
  // Claude models
  { value: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", costMultiplier: 1, isDefault: true },
  { value: "claude-haiku-4.5", label: "Claude Haiku 4.5", costMultiplier: 0.33 },
  { value: "claude-opus-4.5", label: "Claude Opus 4.5", costMultiplier: 3 },
  { value: "claude-sonnet-4", label: "Claude Sonnet 4", costMultiplier: 1 },

  // Gemini models
  { value: "gemini-3-pro-preview", label: "Gemini 3 Pro (Preview)", costMultiplier: 1 },

  // GPT models
  { value: "gpt-5.2-codex", label: "GPT-5.2-Codex", costMultiplier: 1 },
  { value: "gpt-5.2", label: "GPT-5.2", costMultiplier: 1 },
  { value: "gpt-5.1-codex-max", label: "GPT-5.1-Codex-Max", costMultiplier: 1 },
  { value: "gpt-5.1-codex", label: "GPT-5.1-Codex", costMultiplier: 1 },
  { value: "gpt-5.1", label: "GPT-5.1", costMultiplier: 1 },
  { value: "gpt-5", label: "GPT-5", costMultiplier: 1 },
  { value: "gpt-5.1-codex-mini", label: "GPT-5.1-Codex-Mini", costMultiplier: 0.33 },
  { value: "gpt-5-mini", label: "GPT-5 mini", costMultiplier: 0 },
  { value: "gpt-4.1", label: "GPT-4.1", costMultiplier: 0 },
];

/** Default model value */
export const DEFAULT_MODEL = AVAILABLE_MODELS.find((m) => m.isDefault)?.value ?? "claude-sonnet-4.5";

/** Get model by value, returns undefined if not found */
export function getModel(value: string): ModelOption | undefined {
  return AVAILABLE_MODELS.find((m) => m.value === value);
}

/** Get display label for a model value */
export function getModelLabel(value: string): string {
  return getModel(value)?.label ?? value;
}

/** Check if a model value is valid */
export function isValidModel(value: string): boolean {
  return AVAILABLE_MODELS.some((m) => m.value === value);
}

/** Model options formatted for select dropdowns */
export const MODEL_SELECT_OPTIONS = AVAILABLE_MODELS.map((m) => ({
  value: m.value,
  label: m.isDefault ? `${m.label} (default)` : m.label,
}));
