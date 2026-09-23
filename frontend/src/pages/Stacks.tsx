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
import { STACK_STATE_RANK, rankOf, sorted, type SortMode } from '../utils/sort';
import ComposeStackModal, { ComposeStackSubmit } from '../components/ComposeStackModal';
import DeleteButton from '../components/DeleteButton';
import SortSelect from '../components/SortSelect';

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
  const [sortMode, setSortMode] = useState<SortMode>('state');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const filtered = sorted(
    stacks.filter((s) => {
      const term = search.toLowerCase();
      return (
        (s.name as string).toLowerCase().includes(term) ||
        (s.description ?? '').toLowerCase().includes(term)
      );
    }),
    sortMode,
    {
      stateRank: rankOf(STACK_STATE_RANK),
      getState: (s) => s.status,
      getName: (s) => s.name as string,
    }
  );

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
      <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search stacks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: '350px' }}
        />
        <SortSelect value={sortMode} onChange={setSortMode} />
      </div>

      {filtered.length === 0 ? (
        <div
          className="card"
          style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}
        >
          <Layers size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
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
        <div className="card" style={{ overflow: 'hidden' }}>
          {filtered.map((stack, idx) => {
            const name = stack.name as string;
            const isLast = idx === filtered.length - 1;
            return (
              <div
                key={name}
                onClick={() => onSelectStack(name)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                  flexWrap: 'wrap',
                  padding: '12px 16px',
                  cursor: 'pointer',
                  borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      flexShrink: 0,
                      background:
                        stack.status === 'Running'
                          ? 'var(--status-running)'
                          : stack.status === 'Partial'
                          ? 'var(--status-warning)'
                          : 'var(--status-stopped)',
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1rem', fontWeight: 600 }}>{name}</span>
                      {stack.external && (
                        <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                          External
                        </span>
                      )}
                    </div>
                    <div
                      className="font-mono"
                      style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '2px' }}
                    >
                      {stack.external ? (
                        'Not managed by gisco'
                      ) : (
                        <>{stack.compose_file} {stack.has_env && '· .env'}</>
                      )}
                      {' · '}
                      <span>
                        {stack.running_services}/{stack.total_services} active
                      </span>
                    </div>
                    {stack.description && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {stack.description}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
