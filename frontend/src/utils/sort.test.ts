import { describe, expect, it } from 'vitest';
import {
  CONTAINER_STATE_RANK,
  STACK_STATE_RANK,
  rankOf,
  sorted,
} from './sort';

describe('sorted', () => {
  const stacks = [
    { name: 'b', status: 'Stopped' },
    { name: 'a', status: 'Running' },
    { name: 'c', status: 'Partial' },
    { name: 'd', status: 'Running' },
  ];
  const stackOpts = {
    stateRank: rankOf(STACK_STATE_RANK),
    getState: (s: { status: string }) => s.status,
    getName: (s: { name: string }) => s.name,
  };

  it('orders stacks by state then name', () => {
    expect(sorted(stacks, 'state', stackOpts).map((s) => s.name)).toEqual(['a', 'd', 'c', 'b']);
  });

  it('sorts names both directions', () => {
    expect(sorted(stacks, 'name-asc', stackOpts).map((s) => s.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(sorted(stacks, 'name-desc', stackOpts).map((s) => s.name)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('orders containers by state, unknowns last', () => {
    const items = [
      { n: 'z', s: 'exited' },
      { n: 'a', s: 'running' },
      { n: 'm', s: 'paused' },
      { n: 'b', s: 'bogus' },
    ];
    const out = sorted(items, 'state', {
      stateRank: rankOf(CONTAINER_STATE_RANK),
      getState: (c) => c.s,
      getName: (c) => c.n,
    }).map((c) => c.n);
    expect(out).toEqual(['a', 'm', 'z', 'b']);
  });

  it('sorts sizes with ties alpha and unknowns sinking both ways', () => {
    const items = [
      { t: 'c', s: 100 },
      { t: 'a', s: 300 },
      { t: 'b', s: -1 },
      { t: 'd', s: 300 },
    ];
    const opts = { getName: (i: { t: string }) => i.t, getSize: (i: { s: number }) => i.s };
    expect(sorted(items, 'size-desc', opts).map((i) => i.t)).toEqual(['a', 'd', 'c', 'b']);
    expect(sorted(items, 'size-asc', opts).map((i) => i.t)).toEqual(['c', 'a', 'd', 'b']);
  });
});
