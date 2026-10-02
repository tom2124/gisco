import React, { useEffect, useState } from 'react';
import { Disc, Download, Scissors, X } from 'lucide-react';
import { Header } from '../components/Header';
import { ImageSummary } from '../types';
import { api } from '../api/client';
import DeleteButton from '../components/DeleteButton';
import SortSelect from '../components/SortSelect';
import { SIZE_SORT_OPTIONS, sorted, type SortMode } from '../utils/sort';
import { formatBytes, parseImageReference } from '../utils/docker';
import { getErrorMessage, useToast } from '../components/ToastProvider';

const imageTag = (img: ImageSummary) => img.RepoTags?.[0] || '<none>:<none>';

/** True when no repository tag points at this image. */
const isUntagged = (img: ImageSummary) =>
  !img.RepoTags?.length || img.RepoTags.every((t) => t === '<none>:<none>');

export const Images: React.FC = () => {
  const { showToast } = useToast();
  const [images, setImages] = useState<ImageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [pullImageName, setPullImageName] = useState('');
  const [pulling, setPulling] = useState(false);
  const [showPullModal, setShowPullModal] = useState(false);
  const [showPruneModal, setShowPruneModal] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [includeTagged, setIncludeTagged] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('size-desc');

  const visibleImages = sorted(images, sortMode, {
    getName: imageTag,
    getSize: (img) => img.Size,
  });

  // Docker's `dangling` filter means unused *and* untagged, so both branches
  // start from "no container uses this image".
  const pruneCandidates = images.filter(
    (img) => img.Containers === 0 && (includeTagged || isUntagged(img))
  );
  // Shared layers mean this is an upper bound, not the real figure.
  const estimatedReclaim = pruneCandidates.reduce((sum, img) => sum + img.Size, 0);

  // Whether the button is live depends only on whether anything is prunable in
  // principle — not on the current toggle. Deriving it from `pruneCandidates`
  // would disable the button whenever the safe default finds nothing, and the
  // user could then never reach the checkbox that widens the scope.
  const unusedCount = images.filter((img) => img.Containers === 0).length;
  // Unused but still tagged: invisible under the safe default, and the reason
  // the modal can open showing nothing.
  const unusedTaggedCount = images.filter((img) => img.Containers === 0 && !isUntagged(img))
    .length;

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

  const handlePrune = async () => {
    if (pruning) return;
    try {
      setPruning(true);
      const result = await api.pruneImages(!includeTagged);
      setShowPruneModal(false);
      await fetchImages();
      const removed = result.ImagesDeleted?.length ?? 0;
      const reclaimed = result.SpaceReclaimed ?? 0;
      showToast(
        removed > 0
          ? `Pruned ${removed} unused image${removed === 1 ? '' : 's'}; reclaimed ${formatBytes(reclaimed)}.`
          : 'No unused images were removed.',
        'success'
      );
    } catch (err: unknown) {
      showToast(`Image prune failed: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      setPruning(false);
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
              <button
                className="btn btn-secondary"
                onClick={() => setShowPruneModal(true)}
                disabled={pruning || unusedCount === 0}
                title="Preview and prune unused images"
              >
                <Scissors size={14} />
                <span>Prune unused</span>
              </button>
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

      {/* Prune Modal */}
      {showPruneModal && (
        <div className="modal-backdrop" onClick={() => !pruning && setShowPruneModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <div className="modal-header">
              <div>
                <h3>Prune Unused Images</h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '2px' }}>
                  Docker will remove{' '}
                  {includeTagged ? 'all untagged and tagged' : 'untagged'} images that no
                  container references.
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
                  checked={includeTagged}
                  onChange={(e) => setIncludeTagged(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <span>
                  <strong>Include tagged images</strong>
                  <span style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: '2px' }}>
                    Turn off to prune only untagged ({'<none>:<none>'}) images. Tagged images are
                    often still needed by stopped stacks, so this removes more than you may expect.
                  </span>
                </span>
              </label>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{pruneCandidates.length}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  candidate image{pruneCandidates.length === 1 ? '' : 's'}
                  <br />
                  Estimated reclaim: <strong>{formatBytes(estimatedReclaim)}</strong>
                  <br />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    Upper bound: layers shared with kept images are not freed.
                  </span>
                </div>
              </div>

              {pruneCandidates.length > 0 ? (
                <div className="card" style={{ padding: '10px 12px', maxHeight: '220px', overflowY: 'auto' }}>
                  {pruneCandidates.map((img) => (
                    <div
                      key={img.Id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '12px',
                        padding: '6px 0',
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                    >
                      <span className="font-mono" style={{ fontSize: '0.8rem', overflowWrap: 'anywhere' }}>
                        {imageTag(img)}
                      </span>
                      <span className="font-mono" style={{ color: 'var(--text-dim)', fontSize: '0.78rem', flexShrink: 0 }}>
                        {formatBytes(img.Size)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)' }}>
                  No untagged images were found.
                  {/* Point at the checkbox rather than leaving a dead end. */}
                  {!includeTagged && unusedTaggedCount > 0 && (
                    <>
                      {' '}
                      There {unusedTaggedCount === 1 ? 'is' : 'are'}{' '}
                      <strong>{unusedTaggedCount}</strong> unused{' '}
                      {unusedTaggedCount === 1 ? 'image' : 'images'} that still have a tag —
                      tick <em>Include tagged images</em> above to include{' '}
                      {unusedTaggedCount === 1 ? 'it' : 'them'}.
                    </>
                  )}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPruneModal(false)} disabled={pruning}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handlePrune} disabled={pruning}>
                <Scissors size={15} />
                <span>{pruning ? 'Pruning...' : 'Prune Unused Images'}</span>
              </button>
            </div>
          </div>
        </div>
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
