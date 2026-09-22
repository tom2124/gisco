export interface StackColor {
  /** Solid accent for dots, text, row markers. */
  accent: string;
  /** Translucent fill for badges / header backgrounds. */
  soft: string;
  /** Translucent border color. */
  border: string;
}

/** Deterministic 32-bit hash of a string. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic, stable color per stack name so stacks stay visually
 * distinct (and consistent across reloads) on hosts with many containers.
 */
export function stackColor(stackName: string): StackColor {
  const hue = hashString(stackName) % 360;
  return {
    accent: `hsl(${hue} 75% 65%)`,
    soft: `hsl(${hue} 75% 60% / 0.05)`,
    border: `hsl(${hue} 75% 60% / 0.35)`,
  };
}

/** Neutral styling for standalone (non-stack) containers. */
export const STANDALONE_COLOR: StackColor = {
  accent: 'var(--text-dim)',
  soft: 'rgba(148, 163, 184, 0.05)',
  border: 'var(--border-subtle)',
};
