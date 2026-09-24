import React from 'react';
import { ExternalLink } from 'lucide-react';
import { ContainerNode, HostPortNode } from '../types';
import ContainerHostPorts from './ContainerHostPorts';
import ContainerTraefik from './ContainerTraefik';

interface NetworkContainerDetailProps {
  container: ContainerNode;
  networkId: string;
  containerHostPorts: HostPortNode[];
  onNavigateToContainers?: () => void;
  onSelectStack?: (stackName: string) => void;
}

const sectionTitle = {
  fontSize: '0.7rem',
  color: 'var(--text-dim)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '6px',
} as const;

/**
 * Expanded view for a container row in the networks table. Shows only what
 * the compact row doesn't: this interface's MAC/gateway, hostname/FQDN,
 * full port mappings, full Traefik routing, and navigation actions.
 */
export const NetworkContainerDetail: React.FC<NetworkContainerDetailProps> = ({
  container,
  networkId,
  containerHostPorts,
  onNavigateToContainers,
  onSelectStack,
}) => {
  const iface = container.interfaces.find((i) => i.network_id === networkId);
  const fqdn =
    container.hostname && container.domainname
      ? `${container.hostname}.${container.domainname}`
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 0' }}>
      {(iface?.mac_address || iface?.gateway) && (
        <div>
          <div style={sectionTitle}>Interface · {iface?.network_name}</div>
          <div className="font-mono" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {iface?.mac_address && <span>MAC: {iface.mac_address}</span>}
            {iface?.mac_address && iface?.gateway && <span> · </span>}
            {iface?.gateway && <span>Gateway: {iface.gateway}</span>}
          </div>
        </div>
      )}

      {(container.hostname || fqdn) && (
        <div>
          <div style={sectionTitle}>Hostnames</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {container.hostname && (
              <span className="font-mono" style={{ fontSize: '0.78rem', color: 'var(--text-info)' }}>
                {container.hostname}
              </span>
            )}
            {fqdn && (
              <span className="font-mono" style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                {fqdn}
              </span>
            )}
          </div>
        </div>
      )}

      <ContainerHostPorts containerHostPorts={containerHostPorts} />
      <ContainerTraefik labels={container.labels} />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: '10px',
        }}
      >
        <div className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          {container.image}
          {container.stack && onSelectStack && (
            <>
              {' · '}
              <span
                style={{ color: 'var(--primary)', cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectStack(container.stack!);
                }}
              >
                {container.stack}
              </span>
            </>
          )}
        </div>
        <button
          className="btn btn-secondary btn-icon"
          title="View in Containers List"
          onClick={onNavigateToContainers}
          disabled={!onNavigateToContainers}
        >
          <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
};

export default NetworkContainerDetail;
