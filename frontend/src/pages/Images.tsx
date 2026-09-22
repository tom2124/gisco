import React, { useEffect, useState } from 'react';
import { Disc, Download } from 'lucide-react';
import { Header } from '../components/Header';
import { ImageSummary } from '../types';
import { api } from '../api/client';
import DeleteButton from '../components/DeleteButton';
import SortSelect from '../components/SortSelect';
import { SIZE_SORT_OPTIONS, sorted, type SortMode } from '../utils/sort';

const imageTag = (img: ImageSummary) => img.RepoTags?.[0] || '<none>:<none>';

export const Images: React.FC = () => {
  const [images, setImages] = useState<ImageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [pullImageName, setPullImageName] = useState('');
  const [pulling, setPulling] = useState(false);
  const [showPullModal, setShowPullModal] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('size-desc');

  const visibleImages = sorted(images, sortMode, {
    getName: imageTag,
    getSize: (img) => img.Size,
  });

  const fetchImages = async () => {
    try {
      setLoading(true);
      const list = await api.listImages();
      setImages(list);
    } catch (err: any) {
      alert(`Failed to load images: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
  }, []);

  const handlePull = async () => {
    if (!pullImageName.trim()) {
      alert('Please enter an image name (e.g. alpine:latest)');
      return;
    }

    try {
      setPulling(true);
      const [img, tag] = pullImageName.trim().split(':');
      await api.pullImage(img, tag);
      setShowPullModal(false);
      setPullImageName('');
      fetchImages();
    } catch (err: any) {
      alert(`Pull failed: ${err.message}`);
    } finally {
      setPulling(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.removeImage(id, true);
      fetchImages();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div>
      <Header
        title="Images"
        subtitle="Manage locally cached Docker images"
        onRefresh={fetchImages}
        isRefreshing={loading}
        actions={
          <button className="btn btn-primary" onClick={() => setShowPullModal(true)}>
            <Download size={16} />
            <span>Pull Image</span>
          </button>
        }
      />

      {images.length === 0 && !loading ? (
        <div className="card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Disc size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
          <h3>No Images Found</h3>
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
                  <th>Image Tag / Repo</th>
                  <th>Image ID</th>
                  <th>Size</th>
                  <th>Containers</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleImages.map((img) => {
                  const tag = imageTag(img);
                  return (
                    <tr key={img.Id}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{tag}</div>
                        {img.RepoTags && img.RepoTags.length > 1 && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                            also: {img.RepoTags.slice(1).join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="font-mono" style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                        {img.Id.replace('sha256:', '').substring(0, 12)}
                      </td>
                      <td className="font-mono" style={{ fontSize: '0.85rem' }}>
                        {formatBytes(img.Size)}
                      </td>
                      <td>
                        <span className="badge badge-stopped">
                          {img.Containers} container(s)
                        </span>
                      </td>
                      <td>
                        <DeleteButton
                          title="Delete Image"
                          onConfirm={() => handleDelete(img.Id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Pull Image Modal */}
      {showPullModal && (
        <div className="modal-backdrop" onClick={() => setShowPullModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h3>Pull Docker Image</h3>
              <button
                className="btn btn-secondary btn-icon"
                onClick={() => setShowPullModal(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>
                Image Reference
              </label>
              <input
                type="text"
                placeholder="e.g. nginx:latest, postgres:16-alpine"
                value={pullImageName}
                onChange={(e) => setPullImageName(e.target.value)}
                autoFocus
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '6px' }}>
                Image will be pulled directly through the Docker daemon
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPullModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handlePull}
                disabled={pulling}
              >
                <Download size={15} />
                <span>{pulling ? 'Pulling...' : 'Pull Image'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
