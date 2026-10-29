import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Square,
  RotateCw,
  Terminal,
  FileText,
  Box,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ContainerMetrics, ContainerSummary, StackContainerInfo } from '../types';
import DeleteButton from './DeleteButton';
import { ModuleMenu, ModuleMenuItem } from './ModuleMenu';
import { stackColor, STANDALONE_COLOR } from '../utils/stackColors';
import { parseTraefikLabels } from '../utils/traefik';
import { api } from '../api/client';
import { CONTAINER_STATE_RANK, rankOf, sorted, type SortMode } from '../utils/sort';
import { formatBytes } from '../utils/docker';

interface ContainerTableProps {
  containers: (ContainerSummary | StackContainerInfo)[];
  metrics: Record<string, ContainerMetrics>;
  onOpenTerminal: (containerId: string, containerName: string, command?: string, interactive?: boolean) => void;
  onOpenLogs: (containerId: string, containerName: string) => void;
  onContainerAction?: (id: string, action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause') => void;
  onDeleteContainer?: (id: string, name: string) => void;
  actionLoading?: string | null;
  showStackColumn?: boolean;
  onSelectStack?: (stackName: string) => void;
  isStackView?: boolean;
  /** Group rows under per-stack headers (Containers page). Off for single-stack views. */
  groupByStack?: boolean;
  /** Container to reveal (and expand) when arriving from global search. */
  focusId?: string | null;
  /** Stack names to badge as external (same indicator as Stacks/StackDetail). */
  externalStackNames?: Set<string>;
  /** Row ordering within each group (or the flat list). Defaults to state, then name. */
  sortMode?: SortMode;
  /** Show a Traefik column (route URL, when present). */
  showTraefik?: boolean;
  /** Render an expandable detail row per container (stack detail view). */
  detailRenderer?: (c: ContainerSummary | StackContainerInfo) => React.ReactNode;
  /**
   * Run a module operation against a container. The caller reports the result;
   * the module's own command never reaches the browser.
   */
  onModuleAction?: (containerId: string, moduleId: string, action: ModuleMenuItem) => void;
  /** Module operations currently running, as "containerId:moduleId". */
  moduleActionLoading?: string | null;
}

const getContainerId = (c: ContainerSummary | StackContainerInfo): string => {
  return 'Id' in c ? c.Id : c.id;
};

const getContainerName = (c: ContainerSummary | StackContainerInfo): string => {
  return 'Names' in c ? (c.Names?.[0] || '').replace(/^\//, '') : c.name;
};

const getContainerState = (c: ContainerSummary | StackContainerInfo): string => {
  return 'State' in c ? c.State : c.state;
};

/** Daemon-reported uptime ("Up 5 hours (healthy)" -> "5 hours"); empty unless running. */
const getContainerUptime = (c: ContainerSummary | StackContainerInfo): string => {
  const state = getContainerState(c);
  if (state !== 'running') return '';
  const status = 'Status' in c ? c.Status : (c as StackContainerInfo).status;
  return (status || '').replace(/^Up\s+/, '').replace(/\s*\(.*\)\s*$/, '');
};

const getContainerImage = (c: ContainerSummary | StackContainerInfo): string => {
  return 'Image' in c ? c.Image : c.image;
};

const getContainerPorts = (c: ContainerSummary | StackContainerInfo) => {
  return 'Ports' in c ? c.Ports : c.ports.map(p => {
    // Parse port string like "0.0.0.0:8080->80/tcp"
    const match = p.match(/(.*):(\d+)->(\d+)\/(\w+)/);
    if (match) {
      return {
        IP: match[1],
        PublicPort: parseInt(match[2]),
        PrivatePort: parseInt(match[3]),
        Type: match[4],
      };
    }
    return { PrivatePort: 0, Type: 'tcp' };
  });
};

const getContainerLabels = (c: ContainerSummary | StackContainerInfo) => {
  if ('Labels' in c) return c.Labels;
  return (c as StackContainerInfo).labels;
};

const getContainerStack = (c: ContainerSummary | StackContainerInfo): string | undefined => {
  return getContainerLabels(c)?.['com.docker.compose.project'];
};

const getContainerService = (c: ContainerSummary | StackContainerInfo): string | undefined => {
  if ('Labels' in c) {
    return c.Labels?.['com.docker.compose.service'];
  }
  return (c as StackContainerInfo).service;
};

export const ContainerTable: React.FC<ContainerTableProps> = ({
  containers,
  metrics,
  onOpenTerminal,
  onOpenLogs,
  onContainerAction,
  onDeleteContainer,
  actionLoading,
  showStackColumn = true,
  onSelectStack,
  isStackView = false,
  groupByStack = true,
  externalStackNames = new Set<string>(),
  sortMode = 'state',
  showTraefik = false,
  detailRenderer,
  focusId,
  onModuleAction,
  moduleActionLoading,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [traefikRouters, setTraefikRouters] = useState<any[]>([]);
  useEffect(() => {
    if (!showTraefik) return;
    let cancelled = false;
    api.getTraefik().then((res) => {
      if (!cancelled && res.enabled) setTraefikRouters(res.routers || []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [showTraefik]);

  // Global search deep-links to a container: expand and scroll to it.
  const focusRowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (!focusId) return;
    if (detailRenderer) setExpandedId(focusId);
    focusRowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [detailRenderer, focusId]);
  const handleExecAction = (containerId: string, containerName: string) => {
    // No explicit shell: backend prefers bash, falls back to POSIX sh
    onOpenTerminal(containerId, containerName, '', true);
  };
  if (containers.length === 0) {
    return (
      <div className="card empty-state">
        <Box size={28} style={{ opacity: 0.3, marginBottom: 'var(--space-8)' }} />
        <p>No containers to display.</p>
      </div>
    );
  }

  // Grouping conflicts with global name ordering because every stack block
  // stays contiguous. Keep the compact grouped view for the default state
  // sort, but flatten the table (with its Stack column) for name sorting.
  const grouped = groupByStack && !isStackView && sortMode === 'state';
  const showStackCol = showStackColumn && !grouped;
  const colCount = 7 + (showStackCol ? 1 : 0) + (showTraefik ? 1 : 0) + (detailRenderer ? 1 : 0);

  const sortedItems = sorted(containers, sortMode, {
    stateRank: rankOf(CONTAINER_STATE_RANK),
    getState: getContainerState,
    getName: getContainerName,
  });

  const groups: { key: string; stack?: string; items: typeof sortedItems }[] = [];
  if (grouped) {
    const byStack = new Map<string, typeof sortedItems>();
    const standalone: typeof sortedItems = [];
    for (const c of sortedItems) {
      const stack = getContainerStack(c);
      if (stack) {
        if (!byStack.has(stack)) byStack.set(stack, []);
        byStack.get(stack)!.push(c);
      } else {
        standalone.push(c);
      }
    }
    for (const stack of byStack.keys()) {
      groups.push({ key: `stack:${stack}`, stack, items: byStack.get(stack)! });
    }
    if (standalone.length > 0) {
      groups.push({ key: 'stack:__standalone__', items: standalone });
    }

    // A group's position follows its highest-priority container, so the
    // default state sort remains global instead of becoming alphabetical by
    // stack name. Standalone containers sort after named stacks at equal rank.
    const rank = (items: typeof sortedItems) =>
      items.reduce(
        (best, container) => Math.min(best, CONTAINER_STATE_RANK[getContainerState(container)] ?? 99),
        99
      );
    groups.sort(
      (a, b) =>
        rank(a.items) - rank(b.items) ||
        (a.stack ?? '\uffff').localeCompare(b.stack ?? '\uffff')
    );
  } else {
    groups.push({ key: 'all', items: sortedItems });
  }

  const renderRow = (c: ContainerSummary | StackContainerInfo, accent: string) => {
    const id = getContainerId(c);
    const name = getContainerName(c);
    const state = getContainerState(c);
    const image = getContainerImage(c);
    const ports = getContainerPorts(c);
    const labels = getContainerLabels(c);
    const service = getContainerService(c);
    const isRunning = state === 'running';
    const m = metrics[id];
    // Both container shapes carry the modules the backend detected.
    const modules = c.modules ?? [];

    return (
      <React.Fragment key={id}>
        <tr
          ref={focusId === id ? focusRowRef : undefined}
          data-container-id={id}
          onClick={detailRenderer ? () => setExpandedId(expandedId === id ? null : id) : undefined}
          className={focusId === id ? 'list-row-focus' : undefined}
          style={detailRenderer ? { cursor: 'pointer' } : undefined}
        >
        <td style={{ width: '68px', padding: 0 }}>
          <div style={{ display: 'flex', gap: 'var(--space-4)', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            {onModuleAction &&
              modules.map((module) => (
                <ModuleMenu
                  key={`${id}:${module.id}`}
                  title={module.label}
                  icon={module.icon}
                  items={module.actions}
                  disabled={moduleActionLoading === `${id}:${module.id}`}
                  onSelect={(action) => onModuleAction(id, module.id, action)}
                />
              ))}
          </div>
        </td>
        <td>
          <div title={name} style={{ fontWeight: 600, fontSize: '0.95rem' }}>
            {name}
          </div>
          <div
            title={`${service ? `service: ${service} · ` : ''}${id.substring(0, 12)} · ${image}`}
            className="font-mono"
            style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}
          >
            {service && `service: ${service} · `}
            <span>{id.substring(0, 12)}</span>
            {' · '}
            <span>{image}</span>
          </div>
        </td>

        <td>
          <span
            className={`badge ${
              state === 'running'
                ? 'badge-running'
                : state === 'paused'
                ? 'badge-partial'
                : 'badge-stopped'
            }`}
          >
            {state}
          </span>
        </td>

        <td
          className="metric-value"
          style={{ fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
        >
          {getContainerUptime(c) || <span style={{ color: 'var(--text-dim)' }}>—</span>}
        </td>

        {showStackCol && (
          <td>
            {labels?.['com.docker.compose.project'] ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-4)',
                  color: 'var(--primary)',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  cursor: onSelectStack ? 'pointer' : 'default',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectStack?.(labels['com.docker.compose.project']);
                }}
              >
                <Layers size={13} />
                {labels['com.docker.compose.project']}
              </span>
            ) : (
              <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                {isStackView ? '—' : 'standalone'}
              </span>
            )}
          </td>
        )}

                <td>
                  {isRunning && m ? (
                    <div
                      className="metric-value container-metrics-cell"
                      style={{ fontSize: '0.82rem' }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          gap: 'var(--space-8)',
                          alignItems: 'center',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                        }}
                      >
                        <span style={{ color: 'var(--primary)', fontWeight: 600, flexShrink: 0 }}>
                          {m.cpu_percent.toFixed(1)}% CPU
                        </span>
                        <span style={{ flexShrink: 0 }}>·</span>
                        <span style={{ flexShrink: 0 }}>
                          {formatBytes(m.memory_usage_bytes)} (
                          {m.memory_percent.toFixed(1)}%)
                        </span>
                      </div>
                      {/* Never wraps: a wrapping line is what made the row
                          change height as the byte counts grew. Clipped with an
                          ellipsis instead, and the full text in the tooltip. */}
                      <div
                        title={`Net: ↓${formatBytes(m.network_rx_bytes)} ↑${formatBytes(m.network_tx_bytes)}`}
                        style={{
                          fontSize: '0.72rem',
                          color: 'var(--text-dim)',
                          marginTop: 'var(--space-2)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        Net: ↓{formatBytes(m.network_rx_bytes)} ↑{formatBytes(m.network_tx_bytes)}
                      </div>
                    </div>
                  ) : isRunning ? (
                    // The same fixed-width box, so the column does not change
                    // width when the first metrics arrive.
                    <div
                      className="container-metrics-cell"
                      style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}
                    >
                      Reading...
                    </div>
                  ) : (
                    <div
                      className="container-metrics-cell"
                      style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}
                    >
                      —
                    </div>
                  )}
                </td>

                <td className="font-mono" style={{ fontSize: '0.8rem' }}>
                  {ports && ports.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      {ports
                        .filter((p, idx, arr) => {
                          // v4 + v6 publish the same mapping twice (0.0.0.0 vs ::);
                          // collapse identical mappings, keeping protocol distinct.
                          const key = `${p.PublicPort}->${p.PrivatePort}/${p.Type || 'tcp'}`;
                          return arr.findIndex(
                            (q) => `${q.PublicPort}->${q.PrivatePort}/${q.Type || 'tcp'}` === key
                          ) === idx;
                        })
                        .map((p, idx) => (
                          <span key={idx} style={{ whiteSpace: 'nowrap' }}>
                            {p.PublicPort
                              ? `${p.IP || '0.0.0.0'}:${p.PublicPort}->${p.PrivatePort}/${p.Type || 'tcp'}`
                              : `${p.PrivatePort}/${p.Type || 'tcp'}`}
                          </span>
                        ))}
                    </div>
                  ) : (
                    '—'
                  )}
                </td>

                {showTraefik && (
                  <td className="font-mono" style={{ fontSize: '0.78rem' }}>
                    {(() => {
                      const containerName = (getContainerName(c) || '').replace(/^\/+/, '');
                      const composeService = getContainerService(c);
                      const labelInfo = parseTraefikLabels(getContainerLabels(c));
                      const labelRoute = (labelInfo?.routers ?? []).find(
                        (r) => r.protocol === 'http' && r.hosts.length > 0
                      );
                      // Prefer a router from a running Traefik instance (covers
                      // defaultRule-generated routes that have no labels).
                      const apiRoute = traefikRouters.find((r: any) => {
                        if (r.container) return r.container === containerName;
                        const svc = String(r.service || '').replace(/@.*$/, '');
                        const nm = String(r.name || '').replace(/@.*$/, '');
                        return [containerName, composeService].filter(Boolean).some((n) =>
                          svc === n || nm === n || svc.startsWith(n + '-') || nm.startsWith(n + '-')
                        );
                      });
                      const route = apiRoute
                        ? { tls: !!apiRoute.tls, hosts: apiRoute.hosts || [] }
                        : labelRoute;
                      const routeUrl = route && route.hosts && route.hosts.length > 0
                        ? `${route.tls ? 'https' : 'http'}://${route.hosts[0]}`
                        : null;
                      if (routeUrl) {
                        return (
                          <a
                            href={routeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Open ${routeUrl} in new tab`}
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: 'var(--text-success)' }}
                          >
                            {routeUrl}
                          </a>
                        );
                      }
                      return <span style={{ color: 'var(--text-dim)' }}>—</span>;
                    })()}
                  </td>
                )}

                <td className="actions-cell">
                  <div
                    style={{ display: 'flex', gap: 'var(--space-8)' }}
                    onClick={detailRenderer ? (e) => e.stopPropagation() : undefined}
                  >
                    {isRunning ? (
                      <>
                        {onContainerAction && (
                          <>
                            <button
                              className="btn btn-secondary btn-icon"
                              title="Stop"
                              disabled={actionLoading?.includes(id)}
                              onClick={() => onContainerAction?.(id, 'stop')}
                            >
                              <Square size={14} color="var(--status-error)" />
                            </button>
                            <button
                              className="btn btn-secondary btn-icon"
                              title="Restart"
                              disabled={actionLoading?.includes(id)}
                              onClick={() => onContainerAction?.(id, 'restart')}
                            >
                              <RotateCw size={14} color="var(--primary)" />
                            </button>
                          </>
                        )}
                        {isRunning && (
                          <button
                            className="btn btn-secondary btn-icon"
                            title="Interactive Shell"
                            onClick={() => handleExecAction(id, name)}
                          >
                            <Terminal size={14} color="var(--primary)" />
                          </button>
                        )}
                      </>
                    ) : onContainerAction && (
                      <button
                        className="btn btn-secondary btn-icon"
                        title="Start"
                        disabled={actionLoading?.includes(id)}
                        onClick={() => onContainerAction?.(id, 'start')}
                      >
                        <Play size={14} color="var(--status-running)" />
                      </button>
                    )}

                    {onOpenLogs && (
                      <button
                        className="btn btn-secondary btn-icon"
                        title="Container Logs"
                        onClick={() => onOpenLogs(id, name)}
                      >
                        <FileText size={14} />
                      </button>
                    )}

                    {onDeleteContainer && (
                      <DeleteButton
                        title="Delete Container"
                        onConfirm={() => onDeleteContainer(id, name)}
                      />
                    )}

                    {
                      /* Module buttons relocated to the left of the container name. */
                    }
                  </div>
                </td>
                {detailRenderer && (
                  <td>
                    <button
                      className="btn btn-secondary btn-icon"
                      style={{ color: expandedId === id ? 'var(--primary)' : 'var(--text-dim)' }}
                      title={expandedId === id ? 'Hide details' : 'Show details'}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedId(expandedId === id ? null : id);
                      }}
                    >
                      {expandedId === id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </td>
                )}
              </tr>
              {detailRenderer && expandedId === id && (
                <tr>
                  <td colSpan={colCount} style={{ background: 'var(--scrim-soft)' }}>
                    {detailRenderer(c)}
                  </td>
                </tr>
              )}
            </React.Fragment>
            );
  };

  return (
    <div className="table-container">
      <table className="container-table">
        <thead>
          <tr>
            <th style={{ width: '68px' }}></th>
            <th>Container</th>
            <th style={{ width: '20ch' }}>State</th>
            <th style={{ width: '30ch' }}>Uptime</th>
            {showStackCol && <th>Stack</th>}
            <th style={{ width: '230px' }}>CPU / Memory</th>
            <th>Ports</th>
            {showTraefik && <th>Traefik</th>}
            <th style={{ width: '260px' }}>Actions</th>
            {detailRenderer && <th style={{ width: '66px' }} />}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const color = group.stack ? stackColor(group.stack) : STANDALONE_COLOR;
            const running = group.items.filter((c) => getContainerState(c) === 'running').length;
            return (
              <React.Fragment key={group.key}>
                {grouped && (
                  <tr>
                    <td
                      colSpan={colCount}
                      style={{
                        background: color.soft,
                        borderBottom: `1px solid ${color.border}`,
                        padding: 'var(--space-12) var(--space-16)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-12)' }}>
                        <span
                          style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: 'var(--radius-circle)',
                            background: color.accent,
                            flexShrink: 0,
                          }}
                        />
                        {group.stack ? (
                          <>
                            <span
                              style={{
                                fontWeight: 700,
                                fontSize: '0.9rem',
                                color: color.accent,
                                cursor: onSelectStack ? 'pointer' : 'default',
                              }}
                              onClick={() => group.stack && onSelectStack?.(group.stack)}
                            >
                              {group.stack}
                            </span>
                            {externalStackNames.has(group.stack) && (
                              <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                                External
                              </span>
                            )}
                          </>
                        ) : (
                          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                            Standalone containers
                          </span>
                        )}
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                          {group.items.length} container(s)
                          {running > 0 && ` · ${running} running`}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                {group.items.map((c) => renderRow(c, color.accent))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default ContainerTable;