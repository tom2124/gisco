import React from 'react';
import { HostPortNode } from '../types';

interface ContainerHostPortsProps {
  containerHostPorts: HostPortNode[];
}

export const ContainerHostPorts: React.FC<ContainerHostPortsProps> = ({ containerHostPorts }) => (
  containerHostPorts.length > 0 ? (
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px', marginTop: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Host Port Mappings
        </span>
        <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-warning)' }}>
          {containerHostPorts.length} mapping(s)
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {containerHostPorts.map((hp, idx) => (
          <div key={idx} style={{
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.2)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 10px',
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