import React from 'react';
import { Server, Folder, Shield } from 'lucide-react';
import { Header } from '../components/Header';
import { SystemStatus } from '../types';

interface SettingsProps {
  status: SystemStatus | null;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const Settings: React.FC<SettingsProps> = ({
  status,
  onRefresh,
  isRefreshing,
}) => {
  return (
    <div>
      <Header
        title="Settings & System"
        subtitle="Runtime configuration and host environment"
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
        {/* Docker Daemon Status */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <Server size={20} color="var(--primary)" />
            <h3>Docker Daemon Connection</h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Connection Status</span>
              <span
                style={{
                  color: status?.docker_connected ? 'var(--status-running)' : 'var(--status-error)',
                  fontWeight: 600,
                }}
              >
                {status?.docker_connected ? '● Connected' : '○ Disconnected'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Docker Engine Version</span>
              <span className="font-mono">{status?.docker_version || 'N/A'}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>API Version</span>
              <span className="font-mono">{status?.docker_api_version || 'N/A'}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Host OS / Platform</span>
              <span>{status?.os || 'Linux'} ({status?.arch || 'x86_64'})</span>
            </div>
          </div>
        </div>

        {/* Storage & Ownership Configuration */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <Folder size={20} color="var(--accent-cyan)" />
            <h3>Storage & Ownership</h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.9rem' }}>
            <div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>
                STACK DIRECTORY (GISCO_STACK_DIR)
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: '0.82rem',
                  background: 'var(--bg-code)',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  wordBreak: 'break-all',
                }}
              >
                {status?.stack_dir}
              </div>
            </div>

            <div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>
                TEMPLATE DIRECTORY (GISCO_TEMPLATE_DIR)
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: '0.82rem',
                  background: 'var(--bg-code)',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  wordBreak: 'break-all',
                }}
              >
                {status?.template_dir}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Default User Ownership</span>
              <span className="font-mono" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                UID: {status?.default_uid} · GID: {status?.default_gid}
              </span>
            </div>
          </div>
        </div>

        {/* Philosophy & Architecture Note */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Shield size={20} color="var(--status-running)" />
            <h3>Philosophy & Data Integrity</h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            <div>
              <strong style={{ color: 'var(--text-main)', display: 'block', marginBottom: '6px' }}>
                Compose-Centric & No Internal Database
              </strong>
              gisco has no hidden internal database to fight with. Your host filesystem is the sole source of truth. Any compose file created or edited manually on the host is picked up automatically.
            </div>

            <div>
              <strong style={{ color: 'var(--text-main)', display: 'block', marginBottom: '6px' }}>
                Permission Preservation
              </strong>
              When editing existing stacks, gisco strictly preserves the existing UID, GID, and file permission mode bits. New stacks are created with your configured default owner.
            </div>

            <div>
              <strong style={{ color: 'var(--text-main)', display: 'block', marginBottom: '6px' }}>
                Lightweight & Docker Socket Access
              </strong>
              Deployed as a single lightweight container requiring only read/write access to `/var/run/docker.sock` and an open port for the web interface.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
