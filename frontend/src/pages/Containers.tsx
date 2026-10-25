import React, { useEffect, useState, useMemo } from 'react';
import { Header } from '../components/Header';
import { ContainerMetrics, ContainerSummary, StackSummary } from '../types';
import { api } from '../api/client';
import { ContainerTable } from '../components/ContainerTable';
import SortSelect from '../components/SortSelect';
import type { SortMode } from '../utils/sort';
import { getErrorMessage, useToast } from '../components/ToastProvider';

interface ContainersProps {
  stacks: StackSummary[];
  /** Container to reveal, set by global search via `#/containers?focus=<id>`. */
  focusId?: string | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenTerminal: (containerId: string, containerName: string, command?: string, interactive?: boolean) => void;
  onOpenLogs: (containerId: string, containerName: string) => void;
  onSelectStack?: (stackName: string) => void;
  /** Increments on each global refresh; re-syncs the container list. */
  refreshToken?: number;
}

export const Containers: React.FC<ContainersProps> = ({
  stacks,
  focusId,
  onRefresh,
  isRefreshing,
  onOpenTerminal,
  onOpenLogs,
  onSelectStack,
  refreshToken,
}) => {
  const { showToast } = useToast();
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('state');
  const [metrics, setMetrics] = useState<Record<string, ContainerMetrics>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [moduleActionLoading, setModuleActionLoading] = useState<string | null>(null);

  const fetchContainers = async () => {
    try {
      setLoading(true);
      const list = await api.listContainers(true);
      setContainers(list);
    } catch (err: unknown) {
      showToast(`Failed to load containers: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContainers();
  }, []);

  // The container list is fetched here, not by the app-level poll, so without
  // this it froze at whatever was true on mount. That matters for the modules a
  // container matches: a container that becomes eligible — or stops being
  // eligible — would keep its stale button, or never gain one, until the page
  // was revisited. The app bumps this token on every global refresh.
  useEffect(() => {
    fetchContainers();
  }, [refreshToken]);

  // Poll metrics for running containers
  useEffect(() => {
    const runningIds = containers
      .filter((c) => c.State === 'running')
      .map((c) => c.Id);

    if (runningIds.length === 0) return;

    let cancelled = false;

    const fetchAllMetrics = async () => {
      try {
        const { metrics: batch } = await api.getContainerMetricsBulk(runningIds);
        if (cancelled) return;
        if (Object.keys(batch).length > 0) {
          setMetrics((prev) => ({ ...prev, ...batch }));
        }
      } catch {
        // Ignore a transient metrics failure; the next tick retries.
      }
    };

    void fetchAllMetrics();
    const interval = setInterval(() => void fetchAllMetrics(), 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [containers]);

  const handleAction = async (
    id: string,
    action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause'
  ) => {
    setActionLoading(`${id}-${action}`);
    try {
      await api.containerAction(id, action);
      fetchContainers();
      onRefresh();
      showToast(`${action} completed.`, 'success');
    } catch (err: unknown) {
      showToast(`Action failed: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleModuleAction = async (
    id: string,
    moduleId: string,
    action: { id: string; label: string }
  ) => {
    setModuleActionLoading(`${id}:${moduleId}`);
    try {
      const result = await api.runModuleAction(id, moduleId, action.id);
      const detail = result.output?.trim();
      if (result.ok) {
        showToast(
          detail ? `${action.label} — ${detail}` : `${action.label} completed.`,
          'success'
        );
      } else {
        showToast(
          detail
            ? `${action.label} failed: ${detail}`
            : `${action.label} failed${result.exit_code !== null ? ` (exit ${result.exit_code})` : ''}.`,
          'error'
        );
      }
    } catch (err: unknown) {
      showToast(
        `${action.label} failed: ${getErrorMessage(err, 'Unknown error')}`,
        'error'
      );
    } finally {
      setModuleActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.removeContainer(id, true);
      fetchContainers();
      onRefresh();
      showToast('Container deleted.', 'success');
    } catch (err: unknown) {
      showToast(`Delete failed: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    }
  };

  const filtered = useMemo(() => {
    return containers.filter((c) => {
      const name = (c.Names?.[0] || '').replace(/^\//, '');
      const image = c.Image || '';
      const stack = c.Labels?.['com.docker.compose.project'] || '';
      const term = search.toLowerCase();
      return (
        name.toLowerCase().includes(term) ||
        image.toLowerCase().includes(term) ||
        stack.toLowerCase().includes(term)
      );
    });
  }, [containers, search]);

  const externalStackNames = useMemo(
    () => new Set(stacks.filter((s) => s.external).map((s) => s.name)),
    [stacks]
  );

  return (
    <div>
      <Header
        title="Containers"
        subtitle="Manage running and stopped Docker containers"
        onRefresh={() => {
          fetchContainers();
          onRefresh();
        }}
        isRefreshing={loading || isRefreshing}
      />

      <div className="page-toolbar">
        <div className="page-toolbar-left">
          <input
            type="text"
            placeholder="Search by container, image, or stack..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <SortSelect value={sortMode} onChange={setSortMode} />
        </div>
      </div>

      <ContainerTable
        containers={filtered}
        focusId={focusId}
        metrics={metrics}
        onOpenTerminal={onOpenTerminal}
        onOpenLogs={onOpenLogs}
        onContainerAction={handleAction}
        onModuleAction={handleModuleAction}
        moduleActionLoading={moduleActionLoading}
        onDeleteContainer={handleDelete}
        actionLoading={actionLoading}
        showStackColumn={true}
        onSelectStack={onSelectStack}
        isStackView={false}
        externalStackNames={externalStackNames}
        sortMode={sortMode}
      />
    </div>
  );
};