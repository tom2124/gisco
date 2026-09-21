import React from 'react';
import {
  Layers,
  Box,
  FileCode,
  Disc,
  Database,
  HardDrive,
  Settings,
  Activity,
} from 'lucide-react';
import { SystemStatus } from '../types';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  status: SystemStatus | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  status,
}) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Activity },
    { id: 'stacks', label: 'Stacks (Compose)', icon: Layers },
    { id: 'templates', label: 'Templates', icon: FileCode },
    { id: 'containers', label: 'Containers', icon: Box },
    { id: 'images', label: 'Images', icon: Disc },
    { id: 'networks', label: 'Networks', icon: Database },
    { id: 'volumes', label: 'Volumes', icon: HardDrive },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-badge">G</div>
        <div>
          <div className="logo-text">gisco</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <div
              key={item.id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => onSelectTab(item.id)}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="daemon-pill">
          <span
            className={`status-dot ${status?.docker_connected ? 'online' : ''}`}
          />
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {status?.docker_connected
              ? `Docker ${status.docker_version || 'Connected'}`
              : 'Docker Disconnected'}
          </div>
        </div>
      </div>
    </aside>
  );
};
