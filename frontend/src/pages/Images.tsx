import React, { useEffect, useState } from 'react';
import { Disc, Download } from 'lucide-react';
import { Header } from '../components/Header';
import { ImageSummary } from '../types';
import { api } from '../api/client';
import DeleteButton from '../components/DeleteButton';
import SortSelect from '../components/SortSelect';
import { SIZE_SORT_OPTIONS, sorted, type SortMode } from '../utils/sort';
import { formatBytes, parseImageReference } from '../utils/docker';
import { getErrorMessage, useToast } from '../components/ToastProvider';

const imageTag = (img: ImageSummary) => img.RepoTags?.[0] || '<none>:<none>';

export const Images: React.FC = () => {
  const { showToast } = useToast();
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
    } catch (err: unknown) {
      showToast(`Failed to load images: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
  }, []);

  const handlePull = async () => {
    if (!pullImageName.trim()) {
      showToast('Please enter an image name (e.g. alpine:latest)', 'warning');
      return;
    }

    try {
      setPulling(true);
      const { image, tag } = parseImageReference(pullImageName);
      await api.pullImage(image, tag);
      setShowPullModal(false);
      setPullImageName('');
      fetchImages();
      showToast(`${image} pulled successfully.`, 'success');
    } catch (err: unknown) {
      showToast(`Pull failed: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      setPulling(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.removeImage(id, true);
      fetchImages();
      showToast('Image deleted.', 'success');
    } catch (err: unknown) {
      showToast(`Delete failed: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    }
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
        <div className="card empty-state">
          <Disc size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
          <h3>No Images Found</h3>
        </div>
      ) : (
        <>
          <div className="page-toolbar">
            <div className="page-toolbar-right">
              <SortSelect value={sortMode} onChange={setSortMode} options={SIZE_SORT_OPTIONS} />
            </div>
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
                        <span className="badge badge-neutral">
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
