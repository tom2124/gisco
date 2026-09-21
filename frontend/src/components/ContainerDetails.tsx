import React from 'react';
import { ContainerNode } from '../types';

interface ContainerDetailsProps {
  container: ContainerNode;
}

export const ContainerDetails: React.FC<ContainerDetailsProps> = ({ container }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', fontSize: '0.78rem' }}>
    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: 'var(--radius-md)' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>CONTAINER ID</div>
      <div className="font-mono" style={{ wordBreak: 'break-all' }}>{container.id}</div>
    </div>
    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: 'var(--radius-md)' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>CREATED</div>
      <div>N/A</div>
    </div>
    {container.stack && (
      <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: 'var(--radius-md)' }}>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>STACK</div>
        <div className="font-mono" style={{ color: 'var(--primary)' }}>{container.stack}</div>
      </div>
    )}
  </div>
);

export default ContainerDetails;