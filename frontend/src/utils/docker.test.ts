import { describe, expect, it } from 'vitest';
import { formatBytes, parseImageReference } from './docker';

describe('parseImageReference', () => {
  it('parses ordinary tagged images', () => {
    expect(parseImageReference('nginx:latest')).toEqual({
      image: 'nginx',
      tag: 'latest',
    });
  });

  it('does not treat a registry port as a tag', () => {
    expect(parseImageReference('localhost:5000/team/app')).toEqual({
      image: 'localhost:5000/team/app',
    });
    expect(parseImageReference('localhost:5000/team/app:1.2')).toEqual({
      image: 'localhost:5000/team/app',
      tag: '1.2',
    });
  });

  it('parses digest references', () => {
    expect(parseImageReference('alpine@sha256:abc123')).toEqual({
      image: 'alpine',
      tag: 'sha256:abc123',
    });
  });
});

describe('formatBytes', () => {
  it('formats zero and IEC units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KiB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GiB');
  });

  it('handles unknown and very large values', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(1024 ** 6)).toBe('1 EiB');
    expect(formatBytes(1024 ** 7)).toBe('1024 EiB');
  });
});
