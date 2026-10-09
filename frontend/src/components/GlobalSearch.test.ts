import { describe, expect, it } from 'vitest';
import { containerDot, stackDot } from './GlobalSearch';

describe('search result state dots', () => {
  it('maps every stack status to a dot variant', () => {
    expect(stackDot('Running')).toBe('online');
    // A partially-up stack should read as attention-worthy, not healthy.
    expect(stackDot('Partial')).toBe('warning');
    expect(stackDot('Stopped')).toBeUndefined();
    expect(stackDot('Empty')).toBeUndefined();
  });

  it('maps container states, treating stopped as neutral', () => {
    expect(containerDot('running')).toBe('online');
    expect(containerDot('paused')).toBe('warning');
    expect(containerDot('restarting')).toBe('warning');
    expect(containerDot('dead')).toBe('error');
    // exited / created / missing are not warnings.
    expect(containerDot('exited')).toBeUndefined();
    expect(containerDot('created')).toBeUndefined();
    expect(containerDot(undefined)).toBeUndefined();
  });
});