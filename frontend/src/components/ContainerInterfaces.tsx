import React, { useMemo } from 'react';
import { ContainerInterface, ContainerNode } from '../types';
import { compareIps } from '../utils/ip';

interface ContainerInterfacesProps {
  container: ContainerNode;
}

export const ContainerInterfaces: React.FC<ContainerInterfacesProps> = ({ container }) => {
  // Stable ascending IP order; the API doesn't guarantee interface order.
  const interfaces = useMemo(
    () =>
      [...container.interfaces].sort((a: ContainerInterface, b: ContainerInterface) =>
        compareIps(a.ip_address, b.ip_address)
      ),
    [container.interfaces]
  );

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {interfaces.map((iface, ifaceIdx) => (
        <div key={iface.network_id} style={{
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.2)',
          borderRadius: 'var(--radius-md)',
          padding: '8px 12px',
          minWidth: '240px',
          flex: 1,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ color: '#10b981', fontSize: '0.75rem' }}>eth{ifaceIdx}</span>
            <span className="font-mono" style={{ color: '#a7f3d0', fontSize: '0.85rem' }}>
              {iface.ip_address || 'host'}
            </span>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>{iface.network_name}</span>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            MAC: {iface.mac_address || 'N/A'}
          </div>
          {iface.aliases && iface.aliases.length > 0 && (
            <div style={{ marginTop: '4px', fontSize: '0.7rem', color: 'var(--text-dim)' }}>
              Aliases: {iface.aliases.join(', ')}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default ContainerInterfaces;
