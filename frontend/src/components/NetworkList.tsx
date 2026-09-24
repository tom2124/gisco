import React, { useMemo, useState } from 'react';
import { Network, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { NetworkGraph, ContainerNode, HostPortNode } from '../types';
import NetworkContainerDetail from './NetworkContainerDetail';
import NetworkDeleteButton from './NetworkDeleteButton';
import Copyable from './Copyable';
import { parseTraefikLabels } from '../utils/traefik';
import { CONTAINER_STATE_RANK, rankOf, sorted, type SortMode } from '../utils/sort';
import { filterUserNetworks } from '../utils/networks';

interface NetworkListProps {
  graph: NetworkGraph;
  onNetworkDeleted?: () => void;
  onNavigateToContainers?: () => void;
  onSelectStack?: (stackName: string) => void;
  /** Ordering of the container rows inside each expanded network. */
  sortMode?: SortMode;
}

const SUB_COLUMNS = 6;

export const NetworkList: React.FC<NetworkListProps> = ({
  graph,
  onNetworkDeleted,
  onNavigateToContainers,
  onSelectStack,
  sortMode = 'state',
}) => {
  const [expandedNetworks, setExpandedNetworks] = useState<Set<string>>(new Set());
  const [expandedContainer, setExpandedContainer] = useState<string | null>(null);

  // Build network -> containers mapping
  const networkContainers = useMemo(() => {
    const map = new Map<string, ContainerNode[]>();
    graph.containers.forEach((c: ContainerNode) => {
      c.interfaces.forEach((iface) => {
        if (!map.has(iface.network_id)) {
          map.set(iface.network_id, []);
        }
        map.get(iface.network_id)!.push(c);
      });
    });
    return map;
  }, [graph]);

  // Networks by attached container count (desc), name as tiebreak
  const sortedNetworks = useMemo(() => {
    return filterUserNetworks(graph.networks).sort((a, b) => {
      const aCount = networkContainers.get(a.id)?.length ?? a.container_count ?? 0;
      const bCount = networkContainers.get(b.id)?.length ?? b.container_count ?? 0;
      if (bCount !== aCount) return bCount - aCount;
      return a.name.localeCompare(b.name);
    });
  }, [graph.networks, networkContainers]);

  const toggleNetwork = (netId: string, hasContainers: boolean) => {
    if (!hasContainers) return;
    setExpandedNetworks((prev) => {
      const next = new Set(prev);
      if (next.has(netId)) {
        next.delete(netId);
        if (expandedContainer?.startsWith(`${netId}:`)) setExpandedContainer(null);
      } else {
        next.add(netId);
      }
      return next;
    });
  };

  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Network</th>
            <th>Subnet &amp; Gateway</th>
            <th>Containers</th>
            <th>Host Ports</th>
            <th>Actions</th>
            <th style={{ width: '150px' }}>Container view</th>
          </tr>
        </thead>
        <tbody>
          {sortedNetworks.map((net) => {
            const containers = sorted(networkContainers.get(net.id) || [], sortMode, {
              stateRank: rankOf(CONTAINER_STATE_RANK),
              getState: (c) => c.state,
              getName: (c) => c.name,
            });
            const hasContainers = containers.length > 0;
            const isExpanded = hasContainers && expandedNetworks.has(net.id);
            const containerCount = net.container_count ?? containers.length;

            // Host ports attached to containers in this network
            const hostPorts = graph.host_ports.filter((hp: HostPortNode) =>
              graph.containers.some((c: ContainerNode) =>
                c.id === hp.target_container_id &&
                c.interfaces.some((i) => i.network_id === net.id)
              )
            );

            return (
              <React.Fragment key={net.id}>
                <tr
                  className={`network-row ${hasContainers ? 'network-row-expandable' : 'network-row-static'}`}
                  onClick={() => toggleNetwork(net.id, hasContainers)}
                  style={{ cursor: hasContainers ? 'pointer' : 'default' }}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: 'var(--radius-md)',
                          background: hasContainers
                            ? 'linear-gradient(135deg, #10b981, #059669)'
                            : 'transparent',
                          border: hasContainers ? 'none' : '1px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: hasContainers ? '#000' : 'var(--text-dim)',
                          flexShrink: 0,
                        }}
                      >
                        <Network size={16} />
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{net.name}</span>
                          {net.internal && (
                            <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>
                              Internal
                            </span>
                          )}
                        </div>
                        <div className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                          {net.driver} · {net.scope}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="font-mono" style={{ fontSize: '0.8rem' }}>
                    <div>{net.subnet || '—'}</div>
                    {net.gateway && (
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>
                        gw: {net.gateway}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-stopped">{containerCount} container(s)</span>
                  </td>
                  <td>
                    {hostPorts.length > 0 ? (
                      <span className="badge" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                        {hostPorts.length} host port(s)
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>—</span>
                    )}
                  </td>
                  <td>
                    <div onClick={(e) => e.stopPropagation()}>
                      <NetworkDeleteButton
                        networkId={net.id}
                        networkName={net.name}
                        onDeleted={() => {
                          setExpandedNetworks((prev) => {
                            if (!prev.has(net.id)) return prev;
                            const next = new Set(prev);
                            next.delete(net.id);
                            return next;
                          });
                          onNetworkDeleted?.();
                        }}
                      />
                    </div>
                  </td>
                  <td className="network-expand-cell">
                    {hasContainers ? (
                      <button
                        className={`network-expand-button ${isExpanded ? 'expanded' : ''}`}
                        title={isExpanded ? 'Hide connected containers' : 'View connected containers'}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleNetwork(net.id, hasContainers);
                        }}
                      >
                        <span>{isExpanded ? 'Hide containers' : 'View containers'}</span>
                        {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                    ) : (
                      <span className="network-no-containers">No containers</span>
                    )}
                  </td>
                </tr>

                {isExpanded && (
                  <tr>
                    <td colSpan={6} style={{ padding: 0, background: 'rgba(0,0,0,0.15)' }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Container</th>
                            <th>IP Address</th>
                            <th>Aliases</th>
                            <th>Published</th>
                            <th>Traefik</th>
                            <th style={{ width: '44px' }} />
                          </tr>
                        </thead>
                        <tbody>
                          {containers.map((c: ContainerNode) => {
                            const iface = c.interfaces.find((i) => i.network_id === net.id);
                            const containerHostPorts = graph.host_ports.filter(
                              (hp) => hp.target_container_id === c.id
                            );
                            const traefik = parseTraefikLabels(c.labels);
                            const traefikRouters = (traefik?.routers ?? []).filter(
                              (r) => r.hosts.length > 0
                            );
                            const detailKey = `${net.id}:${c.id}`;
                            const showDetail = expandedContainer === detailKey;

                            return (
                              <React.Fragment key={c.id}>
                                <tr
                                  onClick={() =>
                                    setExpandedContainer(showDetail ? null : detailKey)
                                  }
                                  style={{ cursor: 'pointer' }}
                                >
                                  <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                                        {c.name}
                                      </span>
                                      <span
                                        className={`badge ${
                                          c.state === 'running' ? 'badge-running' : 'badge-stopped'
                                        }`}
                                      >
                                        {c.state}
                                      </span>
                                    </div>
                                    <div className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                                      {c.stack || c.image}
                                    </div>
                                  </td>
                                  <td className="font-mono" style={{ fontSize: '0.82rem', color: '#a7f3d0' }}>
                                    {iface?.ip_address || '—'}
                                  </td>
                                  <td className="font-mono" style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                                    {iface && iface.aliases.length > 0 ? iface.aliases.join(', ') : '—'}
                                  </td>
                                  <td className="font-mono" style={{ fontSize: '0.78rem' }}>
                                    {(() => {
                                      // v4 + v6 publish the same mapping twice (0.0.0.0 vs ::);
                                      // collapse identical port mappings, keeping protocol distinct.
                                      const seen = new Set<string>();
                                      const unique = containerHostPorts.filter((hp) => {
                                        const key = `${hp.host_port}→${hp.target_container_port}/${hp.protocol}`;
                                        if (seen.has(key)) return false;
                                        seen.add(key);
                                        return true;
                                      });
                                      return unique.length > 0 ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                          {unique.map((hp, idx) => (
                                            <span key={idx} style={{ color: '#f59e0b', whiteSpace: 'nowrap' }}>
                                              {hp.host_port}→{hp.target_container_port}
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <span style={{ color: 'var(--text-dim)' }}>—</span>
                                      );
                                    })()}
                                  </td>
                                  <td className="font-mono" style={{ fontSize: '0.78rem', color: '#a7f3d0' }}>
                                    {traefikRouters.length > 0 ? (
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
                                        {traefikRouters.flatMap((r) =>
                                          r.hosts.map((host) => (
                                            <span key={`${r.name}:${host}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                              <Copyable text={host}>
                                                <span>{host}</span>
                                              </Copyable>
                                              {r.protocol === 'http' && !host.includes('*') && (
                                                <a
                                                  href={`${r.tls ? 'https' : 'http'}://${host}`}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  title={`Open ${host} in new tab`}
                                                  onClick={(e) => e.stopPropagation()}
                                                  style={{ display: 'inline-flex', color: 'var(--text-dim)' }}
                                                >
                                                  <ExternalLink size={12} />
                                                </a>
                                              )}
                                            </span>
                                          ))
                                        )}
                                      </div>
                                    ) : (
                                      <span style={{ color: 'var(--text-dim)' }}>—</span>
                                    )}
                                  </td>
                                  <td>
                                    <button
                                      className="btn btn-secondary btn-icon"
                                      style={{ color: showDetail ? 'var(--primary)' : 'var(--text-dim)' }}
                                      title={showDetail ? 'Hide details' : 'Show details'}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedContainer(showDetail ? null : detailKey);
                                      }}
                                    >
                                      {showDetail ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                    </button>
                                  </td>
                                </tr>
                                {showDetail && (
                                  <tr>
                                    <td colSpan={SUB_COLUMNS} style={{ background: 'rgba(0,0,0,0.2)' }}>
                                      <NetworkContainerDetail
                                        container={c}
                                        networkId={net.id}
                                        containerHostPorts={containerHostPorts}
                                        onNavigateToContainers={onNavigateToContainers}
                                        onSelectStack={onSelectStack}
                                      />
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default NetworkList;
