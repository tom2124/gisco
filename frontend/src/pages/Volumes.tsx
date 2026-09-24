import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HardDrive, Scissors, Search, X } from 'lucide-react';
import { Header } from '../components/Header';
import { DockerVolume } from '../types';
import { api } from '../api/client';
import DeleteButton from '../components/DeleteButton';
import SortSelect from '../components/SortSelect';
import { SIZE_SORT_OPTIONS, sorted, type SortMode } from '../utils/sort';
import { formatBytes } from '../utils/docker';
import { getErrorMessage, useToast } from '../components/ToastProvider';
import Copyable from '../components/Copyable';

const isAnonymousVolume = (volume: DockerVolume) => /^[a-f0-9]{64}$/i.test(volume.Name);

export const Volumes: React.FC = () => {
  const { showToast } = useToast();
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [loading, setLoading] = useState(true);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageFailed, setUsageFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedVolume, setExpandedVolume] = useState<string | null>(null);
  const [includeNamedVolumes, setIncludeNamedVolumes] = useState(true);
  const [showPruneModal, setShowPruneModal] = useState(false);
  const [pruning, setPruning] = useState(false);
  const refreshIdRef = useRef(0);
  const [sortMode, setSortMode] = useState<SortMode>('size-desc');

  const visibleVolumes = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? volumes.filter((volume) =>
          [volume.Name, volume.Driver, volume.Mountpoint, volume.Scope]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(term))
        )
      : volumes;

    return sorted(filtered, sortMode, {
      getName: (volume) => volume.Name,
      getSize: (volume) => volume.UsageData?.Size ?? -1,
    });
  }, [search, sortMode, volumes]);

  const unusedVolumes = useMemo(
    () =>
      volumes.filter(
        (volume) =>
          volume.UsageData?.RefCount === 0 &&
          (includeNamedVolumes || isAnonymousVolume(volume))
      ),
    [includeNamedVolumes, volumes]
  );
  const estimatedReclaim = unusedVolumes.reduce(
    (total, volume) => total + Math.max(0, volume.UsageData?.Size ?? 0),
    0
  );
  const unknownUsageCount = volumes.filter(
    (volume) =>
      (!volume.UsageData || volume.UsageData.RefCount < 0) &&
      (includeNamedVolumes || isAnonymousVolume(volume))
  ).length;

  const fetchVolumes = async () => {
    const requestId = ++refreshIdRef.current;
    const isCurrent = () => refreshIdRef.current === requestId;
    setLoading(true);
    setUsageLoading(true);
    setUsageFailed(false);

    try {
      // The list endpoint is intentionally independent from Docker's expensive
      // /system/df calculation, so rows render immediately.
      const list = await api.listVolumes();
      if (!isCurrent()) return;
      setVolumes(list);
      setLoading(false);

      try {
        const usage = await api.getVolumeUsage();
        if (!isCurrent()) return;
        setVolumes((current) =>
          current.map((volume) => {
            const volumeUsage = usage[volume.Name];
            return { ...volume, UsageData: volumeUsage };
          })
        );
      } catch {
        if (isCurrent()) setUsageFailed(true);
      }
    } catch (err: unknown) {
      if (isCurrent()) showToast(`Failed to load volumes: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      if (isCurrent()) {
        setLoading(false);
        setUsageLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchVolumes();
  }, []);

  const handleDelete = async (name: string) => {
    try {
      await api.removeVolume(name, true);
      await fetchVolumes();
      showToast(`Volume ${name} deleted.`, 'success');
    } catch (err: unknown) {
      showToast(`Delete failed: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    }
  };

  const handlePrune = async () => {
    if (pruning) return;
    try {
      setPruning(true);
      const result = await api.pruneVolumes(includeNamedVolumes);
      setShowPruneModal(false);
      await fetchVolumes();
      const deleted = result.VolumesDeleted?.length ?? 0;
      const reclaimed = result.SpaceReclaimed ?? 0;
      showToast(
        deleted > 0
          ? `Pruned ${deleted} unused volume${deleted === 1 ? '' : 's'}; reclaimed ${formatBytes(reclaimed)}.`
          : 'No unused volumes were removed.',
        'success'
      );
    } catch (err: unknown) {
      showToast(`Volume prune failed: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      setPruning(false);
    }
  };

  return (
    <div>
      <Header
        title="Volumes"
        subtitle="Manage persistent Docker storage volumes"
        onRefresh={fetchVolumes}
        isRefreshing={loading}
      />

      {volumes.length === 0 && !loading ? (
        <div className="card empty-state">
          <HardDrive size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
          <h3>No Volumes Found</h3>
        </div>
      ) : visibleVolumes.length === 0 && !loading ? (
        <div className="card empty-state">
          <Search size={28} style={{ opacity: 0.3, marginBottom: '10px' }} />
          <h3>No Matching Volumes</h3>
          <p>Try a different name, driver, scope, or mountpoint.</p>
        </div>
      ) : (
        <>
          <div className="page-toolbar">
            <div className="page-toolbar-left">
              <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: '420px' }}>
                <input
                  type="text"
                  placeholder="Search volumes, drivers, mountpoints..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  style={{ paddingLeft: '34px' }}
                />
                <Search
                  size={15}
                  style={{
                    position: 'absolute',
                    left: '11px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-dim)',
                    pointerEvents: 'none',
                  }}
                />
              </div>
            </div>

            <div className="page-toolbar-right">
              {usageLoading && <span className="page-toolbar-status">Calculating sizes…</span>}
              {usageFailed && !usageLoading && (
                <span className="page-toolbar-status warning">Sizes unavailable</span>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => setShowPruneModal(true)}
                disabled={usageLoading || pruning || (unusedVolumes.length === 0 && unknownUsageCount === 0)}
                title="Preview and prune unused volumes"
              >
                <Scissors size={14} />
                <span>Prune unused</span>
              </button>
              <SortSelect value={sortMode} onChange={setSortMode} options={SIZE_SORT_OPTIONS} />
            </div>
          </div>
          <div className="table-container">
            <table className="volume-table">
              <colgroup>
                <col style={{ width: '32%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '16%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Volume Name</th>
                  <th>Driver</th>
                  <th>Size</th>
                  <th>References</th>
                  <th>Scope</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleVolumes.map((volume) => {
                  const referenceCount = volume.UsageData?.RefCount;
                  return (
                    <React.Fragment key={volume.Name}>
                      <tr
                        onClick={() => setExpandedVolume((current) => current === volume.Name ? null : volume.Name)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{volume.Name}</div>
                          {volume.CreatedAt && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                              Created: {new Date(volume.CreatedAt).toLocaleDateString()}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className="badge badge-neutral">{volume.Driver || 'local'}</span>
                        </td>
                        <td className="font-mono" style={{ fontSize: '0.85rem' }}>
                          {formatBytes(volume.UsageData?.Size ?? -1)}
                        </td>
                        <td>
                          {referenceCount === undefined || referenceCount < 0 ? (
                            <span className="badge badge-neutral">Unknown</span>
                          ) : (
                            <span className={`badge ${referenceCount === 0 ? 'badge-warning' : 'badge-running'}`}>
                              {referenceCount} container{referenceCount === 1 ? '' : 's'}
                            </span>
                          )}
                        </td>
                        <td>{volume.Scope || 'local'}</td>
                        <td>
                          <DeleteButton
                            title="Delete Volume"
                            onConfirm={() => handleDelete(volume.Name)}
                          />
                        </td>
                      </tr>
                      {expandedVolume === volume.Name && (
                        <tr>
                          <td
                            colSpan={6}
                            style={{
                              padding: '10px 16px',
                              background: 'rgba(0, 0, 0, 0.18)',
                              borderTop: '1px solid var(--border-subtle)',
                            }}
                          >
                            <div
                              className="font-mono"
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                minWidth: 0,
                                overflowX: 'auto',
                                whiteSpace: 'nowrap',
                                color: 'var(--text-dim)',
                                fontSize: '0.78rem',
                              }}
                            >
                              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>Mountpoint</span>
                              <Copyable text={volume.Mountpoint}>
                                <span>{volume.Mountpoint}</span>
                              </Copyable>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showPruneModal && (
        <div className="modal-backdrop" onClick={() => !pruning && setShowPruneModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()} style={{ maxWidth: '560px' }}>
            <div className="modal-header">
              <div>
                <h3>Prune Unused Volumes</h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '2px' }}>
                  Docker will remove {includeNamedVolumes ? 'named and anonymous' : 'anonymous'} volumes with no container references.
                </div>
              </div>
              <button
                className="btn btn-secondary btn-icon"
                onClick={() => setShowPruneModal(false)}
                disabled={pruning}
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '9px',
                  marginBottom: '16px',
                  padding: '10px 12px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={includeNamedVolumes}
                  onChange={(event) => setIncludeNamedVolumes(event.target.checked)}
                  style={{ width: 'auto' }}
                />
                <span>
                  <strong>Include named volumes</strong>
                  <span style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: '2px' }}>
                    Turn off to prune only anonymous volumes.
                  </span>
                </span>
              </label>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{unusedVolumes.length}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  known unused volume{unusedVolumes.length === 1 ? '' : 's'}
                  <br />
                  Estimated reclaim: <strong>{formatBytes(estimatedReclaim)}</strong>
                </div>
              </div>

              {unknownUsageCount > 0 && (
                <div className="badge badge-warning" style={{ marginBottom: '12px', whiteSpace: 'normal', textAlign: 'left' }}>
                  {unknownUsageCount} volume{unknownUsageCount === 1 ? '' : 's'} have unavailable usage data. Docker will determine their usage when pruning.
                </div>
              )}

              {unusedVolumes.length > 0 ? (
                <div className="card" style={{ padding: '10px 12px', maxHeight: '220px', overflowY: 'auto' }}>
                  {unusedVolumes.map((volume) => (
                    <div key={volume.Name} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                      <span className="font-mono" style={{ fontSize: '0.8rem', overflowWrap: 'anywhere' }}>{volume.Name}</span>
                      <span className="font-mono" style={{ color: 'var(--text-dim)', fontSize: '0.78rem', flexShrink: 0 }}>
                        {formatBytes(volume.UsageData?.Size ?? -1)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)' }}>No known unused volumes were found.</p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPruneModal(false)} disabled={pruning}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handlePrune} disabled={pruning}>
                <Scissors size={15} />
                <span>{pruning ? 'Pruning...' : 'Prune Unused Volumes'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
