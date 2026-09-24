import React from 'react';
import {
  Layers,
  Box,
  Disc,
  FileCode,
  Server,
} from 'lucide-react';
import { Header } from '../components/Header';
import { StackSummary, SystemStatus } from '../types';
import { STACK_STATE_RANK, rankOf, sorted } from '../utils/sort';

interface DashboardProps {
  status: SystemStatus | null;
  stacks: StackSummary[];
  onSelectTab: (tab: string) => void;
  onSelectStack: (name: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({
  status,
  stacks,
  onSelectTab,
  onSelectStack,
  onRefresh,
  isRefreshing,
}) => {
  const runningStacks = stacks.filter((s) => s.status === 'Running').length;
  const partialStacks = stacks.filter((s) => s.status === 'Partial').length;
  const managedStacks = stacks.filter((s) => !s.external);
  const orderedStacks = sorted(managedStacks, 'state', {
    stateRank: rankOf(STACK_STATE_RANK),
    getState: (s) => s.status,
    getName: (s) => s.name,
  });

  return (
    <div>
      <Header
        title="Dashboard"
        subtitle="System overview and cluster state"
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        actions={
          <button
            className="btn btn-primary"
            onClick={() => onSelectTab('stacks')}
          >
            <Layers size={16} />
            <span>Manage Stacks</span>
          </button>
        }
      />

      {/* Metric Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        <div className="card interactive" onClick={() => onSelectTab('stacks')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Compose Stacks</span>
            <Layers size={17} color="var(--primary)" />
          </div>
          <div style={{ fontSize: '1.7rem', fontWeight: 700, margin: '8px 0 4px' }}>
            {stacks.length}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--status-running)', fontWeight: 600 }}>{runningStacks} running</span>
            {partialStacks > 0 && <span> · {partialStacks} partial</span>}
          </div>
        </div>

        <div className="card interactive" onClick={() => onSelectTab('containers')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Containers</span>
            <Box size={17} color="var(--status-running)" />
          </div>
          <div style={{ fontSize: '1.7rem', fontWeight: 700, margin: '8px 0 4px' }}>
            {status?.containers_total ?? 0}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--status-running)', fontWeight: 600 }}>
              {status?.containers_running ?? 0} active
            </span>{' '}
            · {status?.containers_stopped ?? 0} stopped
          </div>
        </div>

        <div className="card interactive" onClick={() => onSelectTab('images')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Docker Images</span>
            <Disc size={17} color="var(--accent-indigo)" />
          </div>
          <div style={{ fontSize: '1.7rem', fontWeight: 700, margin: '8px 0 4px' }}>
            {status?.images_count ?? 0}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Available locally on host
          </div>
        </div>
      </div>

      {/* Two column layout: Stacks preview + Host specs */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
        {/* Recent Stacks */}
        <div className="card">
          <div
            style={{
              marginBottom: '20px',
            }}
          >
            <h3>Managed Compose Stacks</h3>
          </div>

          {managedStacks.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ marginBottom: '16px' }}>No compose stacks discovered in your stack directory.</p>
              <button
                className="btn btn-primary"
                onClick={() => onSelectTab('templates')}
              >
                <FileCode size={16} />
                <span>Create from Template</span>
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '400px', overflowY: 'auto', paddingRight: '4px' }}>
              {orderedStacks.map((stack) => (
                <div
                  key={stack.name}
                  onClick={() => onSelectStack(stack.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background:
                          stack.status === 'Running'
                            ? 'var(--status-running)'
                            : stack.status === 'Partial'
                            ? 'var(--status-warning)'
                            : 'var(--status-stopped)',
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                        {stack.name}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                        {stack.running_services} / {stack.total_services} services running
                      </div>
                    </div>
                  </div>

                  <span
                    className={`badge ${
                      stack.status === 'Running'
                        ? 'badge-running'
                        : stack.status === 'Partial'
                        ? 'badge-partial'
                        : 'badge-stopped'
                    }`}
                  >
                    {stack.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Host & Engine Details */}
        <div className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '20px',
            }}
          >
            <Server size={18} color="var(--primary)" />
            <h3>Engine & Runtime</h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.88rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Status</span>
              <span style={{ color: status?.docker_connected ? 'var(--status-running)' : 'var(--status-error)', fontWeight: 600 }}>
                {status?.docker_connected ? 'Daemon Connected' : 'Disconnected'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Docker Version</span>
              <span className="font-mono">{status?.docker_version || 'N/A'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>API Version</span>
              <span className="font-mono">{status?.docker_api_version || 'N/A'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>OS / Platform</span>
              <span>{status?.os || 'Linux'} ({status?.arch || 'x86_64'})</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Default User</span>
              <span className="font-mono">{status?.default_uid}:{status?.default_gid}</span>
            </div>

            <div
              style={{
                marginTop: '12px',
                paddingTop: '12px',
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '4px' }}>
                STACK STORAGE DIRECTORY
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: '0.78rem',
                  background: 'var(--bg-code)',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  wordBreak: 'break-all',
                }}
              >
                {status?.stack_dir}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
