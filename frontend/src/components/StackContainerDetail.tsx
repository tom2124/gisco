import React from 'react';
import type { ContainerNode, StackContainerInfo } from '../types';
import ContainerDns from './ContainerDns';
import ContainerHostPorts from './ContainerHostPorts';
import ContainerTraefik from './ContainerTraefik';

interface StackContainerDetailProps {
  container: StackContainerInfo;
}

/** Adapt stack info to the node shape the shared detail sections expect. */
function toNode(c: StackContainerInfo): ContainerNode {
  return {
    id: c.id,
    name: c.name,
    image: c.image,
    state: c.state,
    interfaces: c.interfaces,
    ports: [],
    hostname: c.hostname,
    domainname: c.domainname,
    labels: c.labels,
  };
}

const sectionTitle = {
  fontSize: '0.7rem',
  color: 'var(--text-dim)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: 'var(--space-8)',
} as const;

/**
 * Expanded view for a stack container row: interface MAC/gateway per
 * network, DNS names, full host port mappings and Traefik routing.
 * Name/state/image/ports live in the row itself and are not repeated.
 */
export const StackContainerDetail: React.FC<StackContainerDetailProps> = ({ container }) => {
  const node = toNode(container);
  const macRows = container.interfaces.filter((i) => i.mac_address || i.gateway);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-12)', padding: 'var(--space-4) 0' }}>
      {macRows.length > 0 && (
        <div>
          <div style={sectionTitle}>Interfaces</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {macRows.map((iface) => (
              <div
                key={iface.network_id}
                className="font-mono"
                style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}
              >
                <span style={{ color: 'var(--primary)' }}>{iface.network_name}</span>
                <span style={{ color: 'var(--text-dim)' }}>: </span>
                <span style={{ color: 'var(--text-success)' }}>{iface.ip_address || 'host'}</span>
                {iface.mac_address && <span> · MAC: {iface.mac_address}</span>}
                {iface.gateway && <span> · Gateway: {iface.gateway}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <ContainerDns container={node} />
      <ContainerHostPorts containerHostPorts={container.host_ports ?? []} />
      <ContainerTraefik labels={container.labels} />
    </div>
  );
};

export default StackContainerDetail;
