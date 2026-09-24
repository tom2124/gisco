import React, { useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { Header } from '../components/Header';
import { DockerVolume } from '../types';
import { api } from '../api/client';
import DeleteButton from '../components/DeleteButton';
import SortSelect from '../components/SortSelect';
import { SIZE_SORT_OPTIONS, sorted, type SortMode } from '../utils/sort';
import { formatBytes } from '../utils/docker';

export const Volumes: React.FC = () => {
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>('size-desc');

  const visibleVolumes = sorted(volumes, sortMode, {
    getName: (v) => v.Name,
    getSize: (v) => v.UsageData?.Size ?? -1,
  });

  const fetchVolumes = async () => {
    try {
      setLoading(true);
      const list = await api.listVolumes();
      setVolumes(list);
    } catch (err: any) {
      alert(`Failed to load volumes: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVolumes();
  }, []);

  const handleDelete = async (name: string) => {
    try {
      await api.removeVolume(name, true);
      fetchVolumes();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
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
        <div className="card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <HardDrive size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
          <h3>No Volumes Found</h3>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
            <SortSelect value={sortMode} onChange={setSortMode} options={SIZE_SORT_OPTIONS} />
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Volume Name</th>
                  <th>Driver</th>
                  <th>Mountpoint</th>
                  <th>Size</th>
                  <th>Scope</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleVolumes.map((v) => (
                  <tr key={v.Name}>
                    <td style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{v.Name}</div>
                      {v.CreatedAt && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                          Created: {new Date(v.CreatedAt).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-stopped">{v.Driver || 'local'}</span>
                    </td>
                    <td className="font-mono" style={{ fontSize: '0.8rem', color: 'var(--text-dim)', wordBreak: 'break-all', minWidth: 0 }}>
                      {v.Mountpoint}
                    </td>
                    <td className="font-mono" style={{ fontSize: '0.85rem' }}>
                      {formatBytes(v.UsageData?.Size ?? -1)}
                    </td>
                    <td>{v.Scope || 'local'}</td>
                    <td>
                      <DeleteButton
                        title="Delete Volume"
                        onConfirm={() => handleDelete(v.Name)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
