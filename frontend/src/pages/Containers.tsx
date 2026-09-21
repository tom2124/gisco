import React, { useEffect, useState, useMemo } from 'react';
import { Header } from '../components/Header';
import { ContainerMetrics, ContainerSummary } from '../types';
import { api } from '../api/client';
import { ContainerTable } from '../components/ContainerTable';

interface ContainersProps {
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenTerminal: (containerId: string, containerName: string, command?: string, interactive?: boolean) => void;
  onOpenLogs: (containerId: string, containerName: string) => void;
  onSelectStack?: (stackName: string) => void;
}

export const Containers: React.FC<ContainersProps> = ({
  onRefresh,
  isRefreshing,
  onOpenTerminal,
  onOpenLogs,
  onSelectStack,
}) => {
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [metrics, setMetrics] = useState<Record<string, ContainerMetrics>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchContainers = async () => {
    try {
      setLoading(true);
      const list = await api.listContainers(true);
      setContainers(list);
    } catch (err: any) {
      alert(`Failed to load containers: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContainers();
  }, []);

  // Poll metrics for running containers
  useEffect(() => {
    const runningIds = containers
      .filter((c) => c.State === 'running')
      .map((c) => c.Id);

    if (runningIds.length === 0) return;

    const fetchAllMetrics = async () => {
      for (const id of runningIds) {
        try {
          const m = await api.getContainerMetrics(id);
          setMetrics((prev) => ({ ...prev, [id]: m }));
        } catch {
          // ignore transient metrics failure
        }
      }
    };

    fetchAllMetrics();
    const interval = setInterval(fetchAllMetrics, 4000);
    return () => clearInterval(interval);
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
    } catch (err: any) {
      alert(`Action failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.removeContainer(id, true);
      fetchContainers();
      onRefresh();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const filtered = useMemo(() => {
    return containers.filter((c) => {
      const name = c.Names?.[0] || '';
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

      {/* Filter */}
      <div style={{ marginBottom: '24px', maxWidth: '360px' }}>
        <input
          type="text"
          placeholder="Search by container, image, or stack..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <ContainerTable
        containers={filtered}
        metrics={metrics}
        onOpenTerminal={onOpenTerminal}
        onOpenLogs={onOpenLogs}
        onContainerAction={handleAction}
        onDeleteContainer={handleDelete}
        actionLoading={actionLoading}
        showStackColumn={true}
        onSelectStack={onSelectStack}
        isStackView={false}
      />
    </div>
  );
};