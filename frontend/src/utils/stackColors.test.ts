import { describe, expect, it } from 'vitest';
import { STANDALONE_COLOR, stackColor } from './stackColors';

describe('stackColor', () => {
  it('is deterministic per stack name', () => {
    expect(stackColor('nginx-1')).toEqual(stackColor('nginx-1'));
  });

  it('returns accent, soft and border colors', () => {
    const c = stackColor('demo');
    expect(c.accent).toMatch(/^hsl\(/);
    expect(c.soft).toContain('0.05');
    expect(c.border).toContain('0.35');
  });

  it('differs across names', () => {
    const hues = new Set(['a', 'b', 'c', 'demo', 'traefik'].map((n) => stackColor(n).accent));
    expect(hues.size).toBeGreaterThan(1);
  });

  it('standalone is neutral gray', () => {
    expect(STANDALONE_COLOR.accent).toBe('var(--text-dim)');
  });
});
