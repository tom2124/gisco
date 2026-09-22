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
    { id: 'stacks', label: 'Stacks', icon: Layers },
    { id: 'networks', label: 'Networks', icon: Database },
    { id: 'containers', label: 'Containers', icon: Box },
    { id: 'templates', label: 'Templates', icon: FileCode },
    { id: 'volumes', label: 'Volumes', icon: HardDrive },
    { id: 'images', label: 'Images', icon: Disc },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-badge">
          <svg viewBox="0 0 100 100" width="20" height="20" aria-hidden="true">
            <path d="M387 0Q385 98 376.5 187.0Q368 276 355 356Q348 402 339.5 449.0Q331 496 322.0 537.5Q313 579 302 608Q244 565 188.0 516.5Q132 468 73 399L15 458Q76 532 141.5 591.5Q207 651 284 703Q295 711 307.0 715.5Q319 720 333 720Q353 720 362.5 710.0Q372 700 377 687Q401 628 418.0 546.5Q435 465 448 383Q462 299 471.0 210.5Q480 122 481 21Z" transform="translate(18.3 96) scale(0.1278 -0.1278)" fill="#000" />
          </svg>
        </div>
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
