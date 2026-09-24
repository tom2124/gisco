import React, { useState } from 'react';
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
import { stackColor, STANDALONE_COLOR } from '../utils/stackColors';
import { parseTraefikLabels } from '../utils/traefik';
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
  /** Stack names to badge as external (same indicator as Stacks/StackDetail). */
  externalStackNames?: Set<string>;
  /** Row ordering within each group (or the flat list). Defaults to state, then name. */
  sortMode?: SortMode;
  /** Show a Networks column (IPs + aliases per interface). For detail views carrying interface data. */
  showNetworks?: boolean;
  /** Render an expandable detail row per container (stack detail view). */
  detailRenderer?: (c: ContainerSummary | StackContainerInfo) => React.ReactNode;
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

const getContainerInterfaces = (c: ContainerSummary | StackContainerInfo) => {
  return 'interfaces' in c ? c.interfaces : [];
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
  showNetworks = false,
  detailRenderer,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const handleExecAction = (containerId: string, containerName: string) => {
    // No explicit shell: backend prefers bash, falls back to POSIX sh
    onOpenTerminal(containerId, containerName, '', true);
  };
  if (containers.length === 0) {
    return (
      <div className="card" style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <Box size={28} style={{ opacity: 0.3, marginBottom: '8px' }} />
        <p>No containers to display.</p>
      </div>
    );
  }

  // Grouped view replaces the per-row Stack column: the group header
  // carries the stack name, so the column would just repeat it.
  const grouped = groupByStack && !isStackView;
  const showStackCol = showStackColumn && !grouped;
  const colCount = 6 + (showStackCol ? 1 : 0) + (showNetworks ? 1 : 0) + (detailRenderer ? 1 : 0);

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
    for (const stack of [...byStack.keys()].sort((a, b) => a.localeCompare(b))) {
      groups.push({ key: `stack:${stack}`, stack, items: byStack.get(stack)! });
    }
    if (standalone.length > 0) {
      groups.push({ key: 'stack:__standalone__', items: standalone });
    }
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

    return (
      <React.Fragment key={id}>
        <tr
          onClick={detailRenderer ? () => setExpandedId(expandedId === id ? null : id) : undefined}
          style={detailRenderer ? { cursor: 'pointer' } : undefined}
        >
        <td style={{ boxShadow: `inset 3px 0 0 ${accent}` }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
            {name}
          </div>
          <div className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
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

        <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {getContainerUptime(c) || <span style={{ color: 'var(--text-dim)' }}>—</span>}
        </td>

        {showStackCol && (
          <td>
            {labels?.['com.docker.compose.project'] ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
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
                    <div style={{ fontSize: '0.82rem' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--primary)', fontWeight: 600 }}>
                          {m.cpu_percent.toFixed(1)}% CPU
                        </span>
                        <span>·</span>
                        <span>
                          {formatBytes(m.memory_usage_bytes)} (
                          {m.memory_percent.toFixed(1)}%)
                        </span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '2px' }}>
                        Net: ↓{formatBytes(m.network_rx_bytes)} ↑{formatBytes(m.network_tx_bytes)}
                      </div>
                    </div>
                  ) : isRunning ? (
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                      Reading...
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                      —
                    </span>
                  )}
                </td>

                <td className="font-mono" style={{ fontSize: '0.8rem' }}>
                  {ports && ports.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
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

                {showNetworks && (
                  <td className="font-mono" style={{ fontSize: '0.78rem' }}>
                    {(() => {
                      const ifaces = getContainerInterfaces(c);
                      const route = (parseTraefikLabels(getContainerLabels(c))?.routers ?? []).find(
                        (r) => r.protocol === 'http' && r.hosts.length > 0
                      );
                      const routeUrl = route
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
                            style={{ color: '#a7f3d0' }}
                          >
                            {routeUrl}
                          </a>
                        );
                      }
                      return ifaces.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {ifaces.map((iface) => (
                            <div key={iface.network_id}>
                              <div>
                                <span style={{ color: 'var(--primary)' }}>{iface.network_name}</span>
                                <span style={{ color: 'var(--text-dim)' }}>: </span>
                                <span style={{ color: '#a7f3d0' }}>{iface.ip_address || 'host'}</span>
                              </div>
                              {iface.aliases.length > 0 && (
                                <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>
                                  {iface.aliases.join(', ')}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>—</span>
                      );
                    })()}
                  </td>
                )}

                <td>
                  <div
                    style={{ display: 'flex', gap: '6px' }}
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
                  <td colSpan={colCount} style={{ background: 'rgba(0,0,0,0.2)' }}>
                    {detailRenderer(c)}
                  </td>
                </tr>
              )}
            </React.Fragment>
            );
  };

  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Container</th>
            <th>State</th>
            <th>Uptime</th>
            {showStackCol && <th>Stack</th>}
            <th>CPU / Memory</th>
            <th>Ports</th>
            {showNetworks && <th>Networks</th>}
            <th>Actions</th>
            {detailRenderer && <th style={{ width: '44px' }} />}
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
                        padding: '10px 16px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span
                          style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
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