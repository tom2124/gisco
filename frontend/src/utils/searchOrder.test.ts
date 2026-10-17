import { describe, expect, it } from 'vitest';
import { orderResults, OrderableResult, rankContainer, rankStack, UNRANKED } from './searchOrder';

const KINDS = ['stack', 'template', 'container', 'network'];

interface R extends OrderableResult {
  kind: string;
  title: string;
  stateRank?: number;
}

/** score defaults to 0, i.e. the browse case. */
const s = (title: string, kind = 'stack', stateRank?: number, score = 0) => ({
  result: { kind, title, stateRank } as R,
  score,
});

// orderResults returns the results themselves, not the scored wrappers.
const titles = (rows: R[]) => rows.map((r) => r.title);

describe('orderResults', () => {
  describe('with no query (browse list)', () => {
    it('puts running ahead of stopped, then alphabetical within a state', () => {
      const out = orderResults(
        [
          s('zebra', 'stack', 2), // Stopped
          s('alpha', 'stack', 0), // Running
          s('mango', 'stack', 2), // Stopped
          s('bravo', 'stack', 0), // Running
        ],
        KINDS,
        false
      );
      // Running first (alpha, bravo alphabetically), then Stopped (mango, zebra).
      expect(titles(out)).toEqual(['alpha', 'bravo', 'mango', 'zebra']);
    });

    it('keeps kind grouping ahead of state', () => {
      const out = orderResults(
        [
          s('net', 'network'),
          s('stopped-stack', 'stack', 2),
          s('tpl', 'template'),
          s('running-stack', 'stack', 0),
        ],
        KINDS,
        false
      );
      expect(titles(out)).toEqual(['running-stack', 'stopped-stack', 'tpl', 'net']);
    });

    it('does not interleave the two state scales across kinds', () => {
      // "Partial" stack and "paused" container are both rank 1. Ranking them in a
      // shared tier would put unrelated states next to each other — and would
      // break the palette's per-kind group headers, which are emitted as the
      // kind changes. Kind stays the outer order; state orders within it.
      const out = orderResults(
        [
          s('partial-stack', 'stack', 1),
          s('paused-container', 'container', 1),
          s('running-stack', 'stack', 0),
          s('running-container', 'container', 0),
        ],
        KINDS,
        false
      );
      expect(titles(out)).toEqual([
        'running-stack',
        'partial-stack',
        'running-container',
        'paused-container',
      ]);
    });

    it('sorts unranked kinds alphabetically among themselves', () => {
      const out = orderResults(
        [s('gamma', 'network'), s('alpha', 'network'), s('beta', 'template'), s('delta', 'template')],
        KINDS,
        false
      );
      expect(titles(out)).toEqual(['beta', 'delta', 'alpha', 'gamma']);
    });

    it('puts unknown or missing ranks last', () => {
      const out = orderResults(
        [s('no-rank', 'stack', UNRANKED), s('unknown', 'stack', 99), s('stopped', 'stack', 2)],
        KINDS,
        false
      );
      expect(titles(out)).toEqual(['stopped', 'no-rank', 'unknown']);
    });

    it('is stable for items equal on every key', () => {
      const a = { result: { kind: 'stack', title: 'same', stateRank: 0 } as R, score: 0 };
      const b = { ...a, result: { ...a.result } as R };
      const c = { ...a, result: { ...a.result } as R };
      expect(titles(orderResults([a, b, c], KINDS, false))).toEqual(['same', 'same', 'same']);
    });
  });

  describe('with a query', () => {
    it('leads with score and ignores state', () => {
      const out = orderResults(
        [
          s('stopped-exact', 'stack', 2, 100),
          s('running-prefix', 'stack', 0, 50),
          s('running-exact', 'stack', 0, 100),
        ],
        KINDS,
        true
      );
      // Score first: the two 100s (alphabetically), then the 50.
      // A running stack must not jump above a better-scoring stopped one.
      expect(titles(out)).toEqual(['running-exact', 'stopped-exact', 'running-prefix']);
    });

    it('still falls back to kind then title', () => {
      const out = orderResults(
        [
          s('zzz', 'network', 0, 10),
          s('bbb', 'stack', 2, 10),
          s('aaa', 'stack', 0, 10),
          s('mmm', 'network', 9, 10),
        ],
        KINDS,
        true
      );
      expect(titles(out)).toEqual(['aaa', 'bbb', 'mmm', 'zzz']);
    });
  });

  describe('rank helpers', () => {
    it('uses the shared rank tables the Stacks and Containers pages use', () => {
      expect(rankStack('Running')).toBeLessThan(rankStack('Partial'));
      expect(rankStack('Partial')).toBeLessThan(rankStack('Stopped'));
      expect(rankStack('Stopped')).toBeLessThan(rankStack('Empty'));
      expect(rankContainer('running')).toBeLessThan(rankContainer('paused'));
      expect(rankContainer('exited')).toBeLessThan(rankContainer('dead'));
    });

    it('sends unrecognised states last', () => {
      expect(rankStack('Weird')).toBe(UNRANKED);
      expect(rankContainer('zombie')).toBe(UNRANKED);
    });
  });
});