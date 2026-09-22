import React from 'react';
import { Server, Folder, Shield } from 'lucide-react';
import { Header } from '../components/Header';
import { SystemStatus } from '../types';
import { APP_VERSION } from '../generated/version';

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

        {/* About */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Shield size={20} color="var(--status-running)" />
            <h3>About Gisco</h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            <div>
              <a
                href="https://github.com/tom2124/gisco"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--primary)', fontWeight: 600 }}
              >
                github.com/tom2124/gisco
              </a>
            </div>
            <div>By Tom Campbell</div>
            <div>MIT License</div>
            <div
              className="font-mono"
              title="Commit tag this build was made from, or the commit hash if there is no tag"
              style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}
            >
              Build {APP_VERSION}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
