import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Play,
  Square,
  RotateCw,
  FileCode,
} from 'lucide-react';
import { Header } from '../components/Header';
import { StackSummary } from '../types';
import { api } from '../api/client';
import ComposeStackModal, { ComposeStackSubmit } from '../components/ComposeStackModal';
import DeleteButton from '../components/DeleteButton';

interface StacksProps {
  stacks: StackSummary[];
  onSelectStack: (name: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onSelectTab: (tab: string) => void;
}

export const Stacks: React.FC<StacksProps> = ({
  stacks,
  onSelectStack,
  onRefresh,
  isRefreshing,
  onSelectTab,
}) => {
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const filtered = stacks
    .filter((s) =>
      (s.name as string).toLowerCase().includes(search.toLowerCase())
    )
    // Managed stacks first, then externals (backend already sorts by name).
    .sort((a, b) => Number(a.external ?? false) - Number(b.external ?? false));

  const handleAction = async (name: string, action: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(`${name}-${action}`);
    try {
      await api.triggerStackAction(name, action);
      onRefresh();
    } catch (err: any) {
      alert(`Action failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await api.deleteStack(name);
      onRefresh();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleCreate = async ({ name, compose, envContent }: ComposeStackSubmit) => {
    try {
      await api.createStack({
        name,
        compose_content: compose,
        env_content: envContent,
      });
      setShowCreateModal(false);
      onRefresh();
      onSelectStack(name);
    } catch (err: any) {
      alert(`Failed to create stack: ${err.message}`);
    }
  };

  return (
    <div>
      <Header
        title="Compose Stacks"
        subtitle="Manage compose projects stored on host filesystem"
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        actions={
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="btn btn-secondary"
              onClick={() => onSelectTab('templates')}
            >
              <FileCode size={16} />
              <span>From Template</span>
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={16} />
              <span>New Stack</span>
            </button>
          </div>
        }
      />

      {/* Filter bar */}
      <div style={{ marginBottom: '24px', maxWidth: '350px' }}>
        <input
          type="text"
          placeholder="Search stacks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div
          className="card"
          style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}
        >
          <Layers size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
          <h3>No Stacks Found</h3>
          <p style={{ marginTop: '6px', marginBottom: '20px' }}>
            No compose projects found in your stack directory.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus size={16} />
            <span>Create Your First Stack</span>
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '20px',
          }}
        >
          {filtered.map((stack) => {
            const name = stack.name as string;
            return (
              <div
                key={name}
                className="card interactive"
                onClick={() => onSelectStack(name)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minHeight: '190px',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '12px',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <h3 style={{ fontSize: '1.2rem', margin: 0 }}>
                          {name}
                        </h3>
                        {stack.external && (
                          <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                            External
                          </span>
                        )}
                      </div>
                      <div
                        className="font-mono"
                        style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}
                      >
                        {stack.external
                          ? 'Not managed by gisco'
                          : <>{stack.compose_file} {stack.has_env && '· .env'}</>}
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

                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    <strong>{stack.running_services}</strong> of{' '}
                    <strong>{stack.total_services}</strong> services active
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: '16px',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {/* Up needs a compose file; externals are operated via -p only */}
                    {!stack.external && (
                      <button
                        className="btn btn-secondary btn-icon"
                        title="Up (Deploy / Start)"
                        disabled={actionLoading === `${name}-up`}
                        onClick={(e) => handleAction(name, 'up', e)}
                      >
                        <Play size={15} color="var(--status-running)" />
                      </button>
                    )}
                    <button
                      className="btn btn-secondary btn-icon"
                      title="Restart"
                      disabled={actionLoading === `${name}-restart`}
                      onClick={(e) => handleAction(name, 'restart', e)}
                    >
                      <RotateCw size={15} color="var(--primary)" />
                    </button>
                    <button
                      className="btn btn-secondary btn-icon"
                      title="Down (Stop & Remove)"
                      disabled={actionLoading === `${name}-down`}
                      onClick={(e) => handleAction(name, 'down', e)}
                    >
                      <Square size={15} color="var(--status-error)" />
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <DeleteButton
                      title={stack.external ? 'Stop and remove stack containers' : 'Delete stack'}
                      size={15}
                      onConfirm={() => handleDelete(name)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Stack Modal */}
      {showCreateModal && (
        <ComposeStackModal
          title="Create New Compose Stack"
          initialName=""
          initialCompose=""
          composeEditable
          submitLabel="Create & Save"
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
};
