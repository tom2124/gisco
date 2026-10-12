import React from 'react';
import { HostPortNode } from '../types';

interface ContainerHostPortsProps {
  containerHostPorts: HostPortNode[];
}

export const ContainerHostPorts: React.FC<ContainerHostPortsProps> = ({ containerHostPorts }) => (
  containerHostPorts.length > 0 ? (
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-12)', marginTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-8)' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Host Port Mappings
        </span>
        <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-warning)' }}>
          {containerHostPorts.length} mapping(s)
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' }}>
        {containerHostPorts.map((hp, idx) => (
          <div key={idx} style={{
            background: 'var(--warning-wash)',
            border: '1px solid var(--warning-wash-hover)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-8) var(--space-12)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            color: 'var(--text-warning)',
            whiteSpace: 'nowrap',
          }}>
            {hp.host_ip}:{hp.host_port} → {hp.target_container_port}/{hp.protocol}
          </div>
        ))}
      </div>
    </div>
  ) : null
);

export default ContainerHostPorts;