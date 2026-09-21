import React, { useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { Header } from '../components/Header';
import { DockerVolume } from '../types';
import { api } from '../api/client';
import DeleteButton from '../components/DeleteButton';

export const Volumes: React.FC = () => {
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [loading, setLoading] = useState(true);

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

  const formatBytes = (bytes: number) => {
    if (bytes == null || bytes < 0) return '—';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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
        <div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <HardDrive size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
          <h3>No Volumes Found</h3>
        </div>
      ) : (
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
              {volumes.map((v) => (
                <tr key={v.Name}>
                  <td>
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
                  <td className="font-mono" style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
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
      )}
    </div>
  );
};
