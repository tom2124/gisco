import { describe, expect, it } from 'vitest';
import { filterUserNetworks, isBuiltInNetwork } from './networks';

describe('network filtering', () => {
  it('recognizes Docker built-in networks, including the null network', () => {
    expect(isBuiltInNetwork('bridge')).toBe(true);
    expect(isBuiltInNetwork('host')).toBe(true);
    expect(isBuiltInNetwork('none')).toBe(true);
    expect(isBuiltInNetwork('app-network')).toBe(false);
  });

  it('keeps user-defined networks only', () => {
    const networks = [
      { id: '1', name: 'host' },
      { id: '2', name: 'app-network' },
      { id: '3', name: 'none' },
      { id: '4', name: 'internal-services' },
    ];

    expect(filterUserNetworks(networks).map((network) => network.name)).toEqual([
      'app-network',
      'internal-services',
    ]);
  });
});
