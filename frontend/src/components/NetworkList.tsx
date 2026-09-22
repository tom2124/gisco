import React, { useMemo, useState } from 'react';
import { Network, ChevronDown, ChevronUp } from 'lucide-react';
import { NetworkGraph, ContainerNode, HostPortNode } from '../types';
import ContainerCard from './ContainerCard';
import NetworkDeleteButton from './NetworkDeleteButton';
import { CONTAINER_STATE_RANK, rankOf, sorted, type SortMode } from '../utils/sort';

interface NetworkListProps {
  graph: NetworkGraph;
  onNetworkDeleted?: () => void;
  onNavigateToContainers?: () => void;
  onSelectStack?: (stackName: string) => void;
  /** Ordering of the container cards inside each expanded network. */
  sortMode?: SortMode;
}

export const NetworkList: React.FC<NetworkListProps> = ({
  graph,
  onNetworkDeleted,
  onNavigateToContainers,
  onSelectStack,
  sortMode = 'state',
}) => {
  const [expandedNetworks, setExpandedNetworks] = useState<Set<string>>(new Set());

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

  // Sort networks by attached container count (desc), name as tiebreak
  const sortedNetworks = useMemo(() => {
    return [...graph.networks].sort((a, b) => {
      const aCount = networkContainers.get(a.id)?.length ?? a.container_count ?? 0;
      const bCount = networkContainers.get(b.id)?.length ?? b.container_count ?? 0;
      if (bCount !== aCount) return bCount - aCount;
      return a.name.localeCompare(b.name);
    });
  }, [graph.networks, networkContainers]);

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {sortedNetworks.map((net, netIdx) => {
        const containers = sorted(networkContainers.get(net.id) || [], sortMode, {
          stateRank: rankOf(CONTAINER_STATE_RANK),
          getState: (c) => c.state,
          getName: (c) => c.name,
        });
        const hasContainers = containers.length > 0;
        const isExpanded = hasContainers && expandedNetworks.has(net.id);
        const containerCount = net.container_count ?? containers.length;

        // Get network's host ports
        const hostPorts = graph.host_ports.filter((hp: HostPortNode) =>
          graph.containers.some((c: ContainerNode) =>
            c.id === hp.target_container_id &&
            c.interfaces.some((i) => i.network_id === net.id)
          )
        );

        const toggleNetwork = () => {
          if (!hasContainers) return;
          setExpandedNetworks(prev => {
            const next = new Set(prev);
            if (next.has(net.id)) next.delete(net.id);
            else next.add(net.id);
            return next;
          });
        };

        const isLast = netIdx === sortedNetworks.length - 1;

        return (
          <div
            key={net.id}
            style={{
              borderBottom: isLast && !isExpanded ? 'none' : '1px solid var(--border-subtle)',
            }}
          >
            {/* Network Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                cursor: hasContainers ? 'pointer' : 'default',
                background: isExpanded ? 'rgba(16, 185, 129, 0.05)' : 'transparent',
              }}
              onClick={hasContainers ? toggleNetwork : undefined}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: 'var(--radius-md)',
                    background: hasContainers
                      ? 'linear-gradient(135deg, #10b981, #059669)'
                      : 'transparent',
                    border: hasContainers ? 'none' : '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: hasContainers ? '#000' : 'var(--text-dim)',
                  }}
                >
                  <Network size={22} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>{net.name}</h3>
                    <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      {net.driver} · {net.scope}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    <span className="font-mono">{net.subnet || 'No subnet'}</span>
                    <span>Gateway: {net.gateway || 'None'}</span>
                    <span>{containerCount} container(s)</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {net.internal && (
                  <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Internal</span>
                )}
                {hostPorts.length > 0 && (
                  <span className="badge" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                    {hostPorts.length} host port(s)
                  </span>
                )}
                <NetworkDeleteButton
                  networkId={net.id}
                  networkName={net.name}
                  onDeleted={() => {
                    setExpandedNetworks(prev => {
                      if (!prev.has(net.id)) return prev;
                      const next = new Set(prev);
                      next.delete(net.id);
                      return next;
                    });
                    onNetworkDeleted?.();
                  }}
                />
                {hasContainers && (
                  <button
                    className="btn btn-secondary btn-icon"
                    style={{ color: isExpanded ? 'var(--primary)' : 'var(--text-dim)' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleNetwork();
                    }}
                  >
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                )}
              </div>
            </div>

            {/* Expanded Containers */}
            {isExpanded && (
              <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-subtle)', background: 'rgba(0,0,0,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '0.85rem', margin: 0, color: 'var(--text-muted)' }}>
                    {containers.length} container(s) in this network
                  </h4>
                  {graph.host_ports.length > 0 && (
                    <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      {hostPorts.length} host port mapping(s)
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {containers.map((c: ContainerNode) => {
                    const containerHostPorts = graph.host_ports.filter(hp => hp.target_container_id === c.id);

                    return (
                      <ContainerCard
                        key={c.id}
                        container={c}
                        containerHostPorts={containerHostPorts}
                        onNavigateToContainers={onNavigateToContainers}
                        onSelectStack={onSelectStack}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default NetworkList;
