import { describe, expect, it } from 'vitest';
import { normalizeColor } from './resolve';

describe('normalizeColor', () => {
  it('passes hex through unchanged', () => {
    expect(normalizeColor('#38bdf8')).toBe('#38bdf8');
    expect(normalizeColor('  #38BDF8 ')).toBe('#38BDF8');
    expect(normalizeColor('#abc')).toBe('#abc');
  });

  it('converts legacy rgb() to hex when opaque', () => {
    expect(normalizeColor('rgb(19, 27, 43)')).toBe('#131b2b');
    expect(normalizeColor('rgba(19, 27, 43, 1)')).toBe('#131b2b');
  });

  // The reason this function exists: xterm's parseColor only reads alpha from
  // the comma form, so modern space/slash syntax loses it entirely.
  it('preserves alpha from modern rgb() space/slash syntax', () => {
    expect(normalizeColor('rgb(19 27 43 / 0.7)')).toBe('rgba(19, 27, 43, 0.7)');
    expect(normalizeColor('rgb(19 27 43 / 70%)')).toBe('rgba(19, 27, 43, 0.7)');
  });

  it('preserves alpha from legacy rgba()', () => {
    expect(normalizeColor('rgba(255, 255, 255, 0.07)')).toBe('rgba(255, 255, 255, 0.07)');
  });

  it('treats a missing alpha as opaque', () => {
    expect(normalizeColor('rgb(241 245 249)')).toBe('#f1f5f9');
  });

  it('handles percentage channels', () => {
    expect(normalizeColor('rgb(100% 100% 100%)')).toBe('#ffffff');
    expect(normalizeColor('rgb(50% 0% 0% / 0.5)')).toBe('rgba(128, 0, 0, 0.5)');
  });

  it('rounds fractional channels', () => {
    expect(normalizeColor('rgb(56.6 189.2 248.4)')).toBe('#39bdf8');
  });

  it('clamps out-of-range channels rather than emitting bad hex', () => {
    expect(normalizeColor('rgb(300 -20 0)')).toBe('#ff0000');
  });

  it('leaves unrecognised values alone instead of corrupting them', () => {
    expect(normalizeColor('transparent')).toBe('transparent');
    expect(normalizeColor('currentColor')).toBe('currentColor');
    expect(normalizeColor('var(--primary)')).toBe('var(--primary)');
  });
});
