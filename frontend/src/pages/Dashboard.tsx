import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Clock3,
  Disc,
  HardDrive,
  Layers,
} from 'lucide-react';
import { Header } from '../components/Header';
import { ContainerSummary, DockerVolume, ImageSummary, StackSummary, SystemStatus } from '../types';
import { STACK_STATE_RANK, rankOf, sorted } from '../utils/sort';
import { formatBytes } from '../utils/docker';
import { api } from '../api/client';
import { useToast } from '../components/ToastProvider';

interface DashboardProps {
  status: SystemStatus | null;
  stacks: StackSummary[];
  onSelectTab: (tab: string) => void;
  onSelectStack: (name: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

const containerName = (container: ContainerSummary) =>
  (container.Names?.[0] || container.Id.slice(0, 12)).replace(/^\//, '');

const containerStack = (container: ContainerSummary) =>
  container.Labels?.['com.docker.compose.project'];

const isAttentionContainer = (container: ContainerSummary) => {
  const state = container.State?.toLowerCase() ?? '';
  const status = container.Status?.toLowerCase() ?? '';
  return ['paused', 'restarting', 'dead'].includes(state) || status.includes('unhealthy');
};

const formatAge = (created: number) => {
  if (!created) return 'Unknown age';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - created));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const statusClass = (state?: string) => {
  if (state === 'running') return 'badge-running';
  if (state === 'paused' || state === 'restarting') return 'badge-warning';
  if (state === 'dead') return 'badge-error';
  return 'badge-stopped';
};

export const Dashboard: React.FC<DashboardProps> = ({
  status,
  stacks,
  onSelectTab,
  onSelectStack,
  onRefresh,
  isRefreshing,
}) => {
  const { showToast } = useToast();
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [images, setImages] = useState<ImageSummary[]>([]);
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataWarning, setDataWarning] = useState('');
  const dashboardRequestRef = useRef(0);

  const fetchDashboardData = async () => {
    const requestId = ++dashboardRequestRef.current;
    setDataLoading(true);
    const [containerResult, imageResult, volumeResult] = await Promise.allSettled([
      api.listContainers(true),
      api.listImages(),
      api.listVolumes(),
    ]);

    if (requestId !== dashboardRequestRef.current) return;
    if (containerResult.status === 'fulfilled') setContainers(containerResult.value);
    if (imageResult.status === 'fulfilled') setImages(imageResult.value);
    if (volumeResult.status === 'fulfilled') setVolumes(volumeResult.value);

    const failures: string[] = [];
    if (containerResult.status === 'rejected') failures.push('containers');
    if (imageResult.status === 'rejected') failures.push('images');
    if (volumeResult.status === 'rejected') failures.push('volumes');
    const warning = failures.length > 0 ? `Unavailable: ${failures.join(', ')}` : '';
    setDataWarning(warning);
    if (warning) showToast(`Some dashboard data is unavailable: ${failures.join(', ')}`, 'warning');
    setDataLoading(false);
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const runningContainers = useMemo(
    () => containers.filter((container) => container.State === 'running'),
    [containers]
  );
  const attentionContainers = useMemo(
    () => containers.filter(isAttentionContainer),
    [containers]
  );
  const recentContainers = useMemo(
    () => [...containers].sort((a, b) => b.Created - a.Created).slice(0, 5),
    [containers]
  );
  const largestImages = useMemo(
    () => [...images].sort((a, b) => b.Size - a.Size).slice(0, 5),
    [images]
  );
  const orderedStacks = useMemo(
    () => sorted(stacks, 'state', {
      stateRank: rankOf(STACK_STATE_RANK),
      getState: (stack) => stack.status,
      getName: (stack) => stack.name,
    }),
    [stacks]
  );
  const runningStacks = stacks.filter((stack) => stack.status === 'Running').length;
  const partialStacks = stacks.filter((stack) => stack.status === 'Partial').length;
  const imageBytes = images.reduce((total, image) => total + Math.max(0, image.Size), 0);
  const healthMessage = !status?.docker_connected
    ? 'Docker daemon disconnected'
    : attentionContainers.length > 0
      ? `${attentionContainers.length} container${attentionContainers.length === 1 ? '' : 's'} need attention`
      : 'All monitored containers are healthy';

  const refreshDashboard = async () => {
    await Promise.all([fetchDashboardData(), Promise.resolve(onRefresh())]);
  };

  return (
    <div>
      <Header
        title="Dashboard"
        subtitle="Operational overview for this Docker host"
        onRefresh={refreshDashboard}
        isRefreshing={isRefreshing || dataLoading}
        actions={
          <button className="btn btn-primary" onClick={() => onSelectTab('stacks')}>
            <Layers size={16} />
            <span>Manage Stacks</span>
          </button>
        }
      />

      <div className={`dashboard-health-banner ${status?.docker_connected ? (attentionContainers.length > 0 ? 'warning' : 'healthy') : 'error'}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="status-dot online" style={{ background: status?.docker_connected ? 'var(--status-running)' : 'var(--status-error)' }} />
          <div>
            <strong>{status?.docker_connected ? 'Docker host online' : 'Docker host unavailable'}</strong>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '2px' }}>
              {healthMessage}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
          {status?.host_name && <span>{status.host_name}</span>}
          {status?.cpu_count != null && <span>{status.cpu_count} CPUs</span>}
          {status?.memory_total != null && <span>{formatBytes(status.memory_total)} RAM</span>}
        </div>
      </div>

      <div className="dashboard-metrics">
        <button className="card dashboard-metric" onClick={() => onSelectTab('stacks')}>
          <span className="dashboard-metric-label"><Layers size={16} /> Stacks</span>
          <strong>{stacks.length}</strong>
          <span><b style={{ color: 'var(--status-running)' }}>{runningStacks} running</b>{partialStacks > 0 && ` · ${partialStacks} partial`}</span>
        </button>
        <button className="card dashboard-metric" onClick={() => onSelectTab('containers')}>
          <span className="dashboard-metric-label"><Box size={16} /> Containers</span>
          <strong>{status?.containers_total ?? containers.length}</strong>
          <span><b style={{ color: 'var(--status-running)' }}>{status?.containers_running ?? runningContainers.length} running</b>{status?.containers_stopped != null && ` · ${status.containers_stopped} stopped`}</span>
        </button>
        <button className="card dashboard-metric" onClick={() => onSelectTab('images')}>
          <span className="dashboard-metric-label"><Disc size={16} /> Images</span>
          <strong>{images.length || status?.images_count || 0}</strong>
          <span>{formatBytes(imageBytes)} local footprint</span>
        </button>
        <button className="card dashboard-metric" onClick={() => onSelectTab('volumes')}>
          <span className="dashboard-metric-label"><HardDrive size={16} /> Volumes</span>
          <strong>{volumes.length}</strong>
          <span>Persistent storage volumes</span>
        </button>
      </div>

      <div className="dashboard-grid dashboard-grid-primary">
        <section className="card dashboard-section">
          <div className="dashboard-section-header">
            <div>
              <h3>Needs attention</h3>
              <p>Containers that are paused, restarting, unhealthy, or dead.</p>
            </div>
            {attentionContainers.length > 0 && <span className="badge badge-warning">{attentionContainers.length}</span>}
          </div>
          {attentionContainers.length === 0 ? (
            <div className="dashboard-empty-state">
              <CheckCircle2 size={24} color="var(--status-running)" />
              <strong>{status?.docker_connected ? 'Nothing needs attention' : 'Waiting for Docker'}</strong>
              <span>{status?.docker_connected ? 'No unhealthy or unstable containers detected.' : 'Container data will appear when the daemon reconnects.'}</span>
            </div>
          ) : (
            <div className="dashboard-list">
              {attentionContainers.slice(0, 6).map((container) => (
                <button key={container.Id} className="dashboard-list-row" onClick={() => onSelectTab('containers')}>
                  <span className={`status-dot ${container.State === 'running' ? 'online' : ''}`} />
                  <span className="dashboard-list-main">
                    <strong>{containerName(container)}</strong>
                    <span>{container.Image} · {containerStack(container) || 'standalone'}</span>
                  </span>
                  <span className={`badge ${statusClass(container.State)}`}>{container.State}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card dashboard-section">
          <div className="dashboard-section-header">
            <div>
              <h3>Stack health</h3>
              <p>Current service state across managed and external projects.</p>
            </div>
            <button className="btn btn-secondary" onClick={() => onSelectTab('stacks')}>View all</button>
          </div>
          <div className="dashboard-list">
            {orderedStacks.length === 0 ? (
              <div className="dashboard-empty-state compact"><span>No Compose projects discovered.</span></div>
            ) : orderedStacks.slice(0, 6).map((stack) => (
              <button key={stack.name} className="dashboard-list-row" onClick={() => onSelectStack(stack.name)}>
                <span className="status-dot" style={{ background: stack.status === 'Running' ? 'var(--status-running)' : stack.status === 'Partial' ? 'var(--status-warning)' : 'var(--status-stopped)' }} />
                <span className="dashboard-list-main">
                  <strong>{stack.name}</strong>
                  <span>{stack.running_services}/{stack.total_services} services active · {stack.external ? 'external' : stack.compose_file}</span>
                </span>
                <span className={`badge ${stack.status === 'Running' ? 'badge-running' : stack.status === 'Partial' ? 'badge-partial' : 'badge-stopped'}`}>{stack.status}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="dashboard-grid dashboard-grid-secondary">
        <section className="card dashboard-section">
          <div className="dashboard-section-header">
            <div>
              <h3>Recent containers</h3>
              <p>Most recently created containers on this host.</p>
            </div>
            <Clock3 size={17} color="var(--text-dim)" />
          </div>
          {dataLoading && recentContainers.length === 0 ? (
            <div className="dashboard-empty-state compact"><span>Loading containers…</span></div>
          ) : recentContainers.length === 0 ? (
            <div className="dashboard-empty-state compact"><span>No containers found.</span></div>
          ) : (
            <div className="dashboard-list">
              {recentContainers.map((container) => (
                <button key={container.Id} className="dashboard-list-row" onClick={() => onSelectTab('containers')}>
                  <span className={`status-dot ${container.State === 'running' ? 'online' : ''}`} />
                  <span className="dashboard-list-main">
                    <strong>{containerName(container)}</strong>
                    <span>{container.Image} · {containerStack(container) || 'standalone'}</span>
                  </span>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem', flexShrink: 0 }}>{formatAge(container.Created)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card dashboard-section">
          <div className="dashboard-section-header">
            <div>
              <h3>Largest images</h3>
              <p>Local image storage footprint.</p>
            </div>
            <Disc size={17} color="var(--text-dim)" />
          </div>
          {dataLoading && largestImages.length === 0 ? (
            <div className="dashboard-empty-state compact"><span>Loading images…</span></div>
          ) : largestImages.length === 0 ? (
            <div className="dashboard-empty-state compact"><span>No images found.</span></div>
          ) : (
            <div className="dashboard-list">
              {largestImages.map((image) => (
                <button key={image.Id} className="dashboard-list-row" onClick={() => onSelectTab('images')}>
                  <span className="dashboard-list-icon"><Disc size={15} /></span>
                  <span className="dashboard-list-main">
                    <strong>{image.RepoTags?.[0] || '<none>:<none>'}</strong>
                    <span>{image.Containers} container{image.Containers === 1 ? '' : 's'} using this image</span>
                  </span>
                  <span className="font-mono" style={{ color: 'var(--text-muted)', fontSize: '0.75rem', flexShrink: 0 }}>{formatBytes(image.Size)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {dataWarning && (
        <div className="dashboard-data-warning">
          <AlertTriangle size={15} />
          <span>Some dashboard data could not be loaded: {dataWarning.replace('Unavailable: ', '')}</span>
        </div>
      )}
    </div>
  );
};
