export type SortMode = 'state' | 'name-asc' | 'name-desc' | 'size-desc' | 'size-asc';

export interface SortOption {
  value: SortMode;
  label: string;
}

export const STATE_SORT_OPTIONS: SortOption[] = [
  { value: 'state', label: 'State, then name' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
];

export const SIZE_SORT_OPTIONS: SortOption[] = [
  { value: 'size-desc', label: 'Size, largest first' },
  { value: 'size-asc', label: 'Size, smallest first' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
];

export const STACK_STATE_RANK: Record<string, number> = {
  Running: 0,
  Partial: 1,
  Stopped: 2,
  Empty: 3,
};

export const CONTAINER_STATE_RANK: Record<string, number> = {
  running: 0,
  paused: 1,
  restarting: 2,
  created: 3,
  exited: 4,
  removing: 5,
  dead: 6,
};

export const rankOf =
  (ranks: Record<string, number>) =>
  (state: string): number =>
    ranks[state] ?? 99;

/**
 * Sort items by state rank then name (default), size, or purely alphabetical.
 * Array sorting is stable, so equal keys keep their input order.
 * Size modes need getSize (missing sizes count as -1, i.e. unknown sorts last).
 */
export function sorted<T>(
  items: readonly T[],
  mode: SortMode,
  opts: {
    stateRank?: (state: string) => number;
    getState?: (item: T) => string;
    getName: (item: T) => string;
    getSize?: (item: T) => number;
  }
): T[] {
  const arr = [...items];
  const byName = (a: T, b: T) => opts.getName(a).localeCompare(opts.getName(b));
  switch (mode) {
    case 'name-asc':
      return arr.sort(byName);
    case 'name-desc':
      return arr.sort((a, b) => -byName(a, b));
    case 'size-desc':
    case 'size-asc': {
      // Unknown sizes (< 0) always sink to the bottom.
      const size = (t: T) => {
        const s = opts.getSize?.(t) ?? -1;
        return s < 0 ? (mode === 'size-desc' ? -1 : Infinity) : s;
      };
      const dir = mode === 'size-desc' ? -1 : 1;
      return arr.sort((a, b) => dir * (size(a) - size(b)) || byName(a, b));
    }
    case 'state':
    default: {
      const rank = (t: T) => (opts.stateRank && opts.getState ? opts.stateRank(opts.getState(t)) : 99);
      return arr.sort((a, b) => rank(a) - rank(b) || byName(a, b));
    }
  }
}
