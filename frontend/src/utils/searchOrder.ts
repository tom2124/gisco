import { CONTAINER_STATE_RANK, rankOf, STACK_STATE_RANK } from './sort';

/** Minimal shape the ordering needs, so this stays independent of the UI. */
export interface OrderableResult {
  kind: string;
  title: string;
  /** Running-before-stopped rank. Absent for kinds with no runtime state. */
  stateRank?: number;
}

export interface Scored<T> {
  result: T;
  score: number;
}

/**
 * Rank for anything the rank tables do not know about — templates, networks,
 * and any future state Docker grows. Sorts last within its kind, matching
 * `rankOf`'s own fallback.
 */
export const UNRANKED = 99;

/** The two rank tables, bound to their kinds. */
export const rankStack = rankOf(STACK_STATE_RANK);
export const rankContainer = rankOf(CONTAINER_STATE_RANK);

const kindIndex = (kind: string, order: readonly string[]) => {
  const i = order.indexOf(kind);
  return i === -1 ? order.length : i;
};

/**
 * Order search results.
 *
 * With a query, relevance leads: score, then kind, then title. State is
 * deliberately *not* consulted, so typing does not reshuffle equally-scoring
 * matches by whether they happen to be running.
 *
 * With no query the palette is a browse list, so state leads: kind, then state
 * rank, then title alphabetically. This is the same "State, then name" ordering
 * the Stacks and Containers pages use, so a running stack is not buried between
 * stopped ones.
 *
 * State ranks *within* a kind rather than across all of them. The two rank
 * tables scale different things — a "Partial" stack and a "paused" container are
 * both 1, and ranking them in a shared tier would interleave unrelated states.
 * Kind stays the outer order in both modes.
 *
 * The sort is stable, so items equal on every key keep their input order.
 */
export function orderResults<T extends OrderableResult>(
  scored: Scored<T>[],
  kindOrder: readonly string[],
  hasQuery: boolean
): T[] {
  return [...scored]
    .sort((a, b) => {
      // Score leads whenever it discriminates. In browse mode every score is 0
      // (score() returns 0 for an empty query), so this is a no-op there rather
      // than a special case that could be got wrong.
      if (a.score !== b.score) return b.score - a.score;
      const kindDiff = kindIndex(a.result.kind, kindOrder) - kindIndex(b.result.kind, kindOrder);
      if (kindDiff) return kindDiff;
      // State only orders the browse list. With a query, an equally-scoring
      // running match must not outrank a better alphabetical one.
      if (!hasQuery) {
        const rankDiff =
          (a.result.stateRank ?? UNRANKED) - (b.result.stateRank ?? UNRANKED);
        if (rankDiff) return rankDiff;
      }
      return a.result.title.localeCompare(b.result.title);
    })
    .map((entry) => entry.result);
}