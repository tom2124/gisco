import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Disc,
  FileCode,
  Globe,
  Layers,
  Search,
} from 'lucide-react';
import { api } from '../api/client';
import type {
  ContainerSummary,
  NetworkGraph,
  StackSummary,
  TemplateSummary,
} from '../types';

export type SearchKind = 'stack' | 'template' | 'container' | 'network';

export interface SearchResult {
  kind: SearchKind;
  /** Identifier used to build the target URL. */
  id: string;
  title: string;
  /** Secondary line: description, image, driver... */
  detail?: string;
  /** Full text for the row's tooltip, where there is more to say. */
  hint?: string;
  /**
   * State dot, reusing the same classes the rest of the UI uses:
   * `status-dot` alone is the "stopped" grey.
   */
  dot?: 'online' | 'warning' | 'error';
  /** Literal `#/...` the result navigates to. */
  href: string;
}

/** Map a compose stack status onto the shared status-dot variants. */
export function stackDot(status: StackSummary['status']): SearchResult['dot'] {
  if (status === 'Running') return 'online';
  if (status === 'Partial') return 'warning';
  return undefined;
}

/** Same mapping for a container's Docker state. */
export function containerDot(state?: string): SearchResult['dot'] {
  if (state === 'running') return 'online';
  if (state === 'paused' || state === 'restarting') return 'warning';
  if (state === 'dead') return 'error';
  return undefined;
}

interface GlobalSearchProps {
  /** Already-polled by App, so no extra request for the most common query. */
  stacks: StackSummary[];
  onNavigate: (href: string) => void;
}

const KIND_META: Record<SearchKind, { label: string; icon: React.ElementType }> = {
  stack: { label: 'Stacks', icon: Layers },
  template: { label: 'Templates', icon: FileCode },
  container: { label: 'Containers', icon: Box },
  network: { label: 'Networks', icon: Globe },
};

const KIND_ORDER: SearchKind[] = ['stack', 'template', 'container', 'network'];

/** How long fetched lists stay usable before the palette refetches. */
const CACHE_TTL_MS = 30_000;

/** Cap results so a single-letter query cannot build a 10k-row list. */
const MAX_RESULTS = 40;

const isBuiltInNetwork = (name: string) =>
  name === 'bridge' || name === 'host' || name === 'none';

interface Lists {
  containers: ContainerSummary[];
  networks: NetworkGraph['networks'];
  templates: TemplateSummary[];
}

const EMPTY_LISTS: Lists = { containers: [], networks: [], templates: [] };

/**
 * Case-insensitive substring match, scored so that the obvious answers sort
 * first: an exact title beats a title prefix, which beats a title hit, which
 * beats a hit in the description only.
 */
function score(result: SearchResult, query: string): number | null {
  if (query === '') return 0;
  const q = query.toLowerCase();
  const title = result.title.toLowerCase();
  const detail = result.detail?.toLowerCase() ?? '';

  if (title === q) return 100;
  if (title.startsWith(q)) return 80;
  const titleAt = title.indexOf(q);
  if (titleAt === 0) return 70;
  if (titleAt > 0) return 50 - Math.min(titleAt, 20);
  // Word-boundary hit inside the title reads as intentional.
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(title)) return 45;
  if (detail.includes(q)) return 20;
  return null;
}

export const GlobalSearch: React.FC<GlobalSearchProps> = ({ stacks, onNavigate }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [lists, setLists] = useState<Lists>(EMPTY_LISTS);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchedAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /** `/` opens the palette, unless the user is typing somewhere. */
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable ||
        // CodeMirror's editable surface.
        el.closest('.cm-editor') !== null
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setOpen((wasOpen) => !wasOpen);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const [containers, topology, templates] = await Promise.allSettled([
        api.listContainers(true),
        api.getNetworkTopology(),
        api.listTemplates(),
      ]);
      setLists({
        containers: containers.status === 'fulfilled' ? containers.value : [],
        networks: topology.status === 'fulfilled' ? topology.value.networks : [],
        templates: templates.status === 'fulfilled' ? templates.value : [],
      });
      fetchedAtRef.current = Date.now();
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  // Fetch on first open, then only once the cache has gone stale. Stacks come
  // from App's poll and are never fetched here.
  useEffect(() => {
    if (!open) return;
    if (fetchedAtRef.current === 0 || Date.now() - fetchedAtRef.current > CACHE_TTL_MS) {
      void refresh();
    }
  }, [open, refresh]);

  const results = useMemo<SearchResult[]>(() => {
    const all: SearchResult[] = [];

    for (const stack of stacks) {
      const services =
        stack.total_services > 0
          ? `${stack.running_services}/${stack.total_services} services running`
          : 'no services';
      all.push({
        kind: 'stack',
        id: stack.name,
        title: stack.name,
        detail: stack.description,
        hint: `${stack.name} · ${stack.status} · ${services}`,
        dot: stackDot(stack.status),
        href: `#/stacks/${encodeURIComponent(stack.name)}`,
      });
    }
    for (const template of lists.templates) {
      all.push({
        kind: 'template',
        id: template.id,
        title: template.name,
        detail: template.description,
        href: `#/templates?focus=${encodeURIComponent(template.id)}`,
      });
    }
    for (const container of lists.containers) {
      const name = container.Names?.[0]?.replace(/^\//, '') ?? container.Id.slice(0, 12);
      all.push({
        kind: 'container',
        id: container.Id,
        title: name,
        detail: `${container.Image} · ${container.State}`,
        hint: `${name} · ${container.Image} · ${container.State}`,
        dot: containerDot(container.State),
        href: `#/containers?focus=${encodeURIComponent(container.Id)}`,
      });
    }
    for (const network of lists.networks) {
      // The Networks page hides Docker's built-ins (bridge/host/none), so
      // offering them here would produce a result with nowhere to land.
      if (isBuiltInNetwork(network.name)) continue;
      all.push({
        kind: 'network',
        id: network.id,
        title: network.name,
        detail: `${network.driver} · ${network.container_count} container(s)`,
        href: `#/networks?focus=${encodeURIComponent(network.id)}`,
      });
    }

    const scored: Array<{ result: SearchResult; score: number }> = [];
    for (const result of all) {
      const value = score(result, query.trim());
      if (value !== null) scored.push({ result, score: value });
    }
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        KIND_ORDER.indexOf(a.result.kind) - KIND_ORDER.indexOf(b.result.kind) ||
        a.result.title.localeCompare(b.result.title)
    );
    return scored.slice(0, MAX_RESULTS).map((entry) => entry.result);
  }, [lists, query, stacks]);

  // Keep the highlight inside the list as it shrinks.
  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = useCallback(
    (result: SearchResult) => {
      setOpen(false);
      setQuery('');
      onNavigate(result.href);
    },
    [onNavigate]
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  if (!open) return null;

  let lastKind: SearchKind | null = null;

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="search-palette"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Search stacks, templates, containers and networks"
      >
        <div className="search-palette-input">
          <Search size={16} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Search stacks, templates, containers, networks…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => (results.length === 0 ? 0 : (index + 1) % results.length));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) =>
                  results.length === 0 ? 0 : (index - 1 + results.length) % results.length
                );
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const picked = results[active];
                if (picked) choose(picked);
              }
            }}
          />
          <kbd className="search-palette-kbd">esc</kbd>
        </div>

        {loading && lists.containers.length === 0 && (
          <div className="search-palette-status">Loading…</div>
        )}

        <ul className="search-palette-list" ref={listRef}>
          {results.length === 0 ? (
            <li className="search-palette-status">
              {query.trim() === '' ? 'Type to search' : `No matches for “${query.trim()}”`}
            </li>
          ) : (
            results.map((result, index) => {
              const showHeader = result.kind !== lastKind;
              lastKind = result.kind;
              const Icon = KIND_META[result.kind].icon;
              return (
                <React.Fragment key={`${result.kind}:${result.id}`}>
                  {showHeader && (
                    <li className="search-palette-group" aria-hidden="true">
                      {KIND_META[result.kind].label}
                    </li>
                  )}
                  <li
                    data-active={index === active}
                    className="search-palette-item"
                    title={result.hint}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(result)}
                  >
                    {result.dot !== undefined || result.kind === 'stack' ||
                    result.kind === 'container' ? (
                      // Reserve the slot for every stack/container so titles
                      // stay aligned whether or not the state warrants a colour.
                      <span
                        className={`status-dot search-palette-dot${
                          result.dot ? ' ' + result.dot : ''
                        }`}
                        aria-hidden="true"
                      />
                    ) : (
                      <Icon size={14} className="search-palette-icon" />
                    )}
                    <span className="search-palette-title">{result.title}</span>
                    {result.detail && (
                      <span className="search-palette-detail">{result.detail}</span>
                    )}
                  </li>
                </React.Fragment>
              );
            })
          )}
        </ul>

        <div className="search-palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span className="search-palette-hint">
            <Disc size={11} /> press <kbd>/</kbd> anywhere
          </span>
        </div>
      </div>
    </div>
  );
};

export default GlobalSearch;