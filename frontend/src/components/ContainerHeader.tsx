import React from 'react';
import { Server, ExternalLink } from 'lucide-react';
import { ContainerNode } from '../types';

interface ContainerHeaderProps {
  container: ContainerNode;
  onNavigateToContainers?: () => void;
  onSelectStack?: (stackName: string) => void;
}

const ContainerHeader: React.FC<ContainerHeaderProps> = ({ container, onNavigateToContainers, onSelectStack }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: 'var(--radius-md)',
          background: container.state === 'running'
            ? 'linear-gradient(135deg, #10b981, #059669)'
            : 'linear-gradient(135deg, #64748b, #475569)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#000',
        }}
      >
        <Server size={20} />
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h5 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{container.name}</h5>
          <span className={`badge ${container.state === 'running' ? 'badge-running' : 'badge-stopped'}`}>
            {container.state}
          </span>
          {container.stack && (
            <span
              className="font-mono"
              style={{
                fontSize: '0.75rem',
                color: 'var(--primary)',
                cursor: onSelectStack ? 'pointer' : 'default',
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (container.stack) onSelectStack?.(container.stack);
              }}
            >
              {container.stack}
            </span>
          )}
        </div>
        <div className="font-mono" style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '2px' }}>
          {container.image}
        </div>
      </div>
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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

export default ContainerHeader;