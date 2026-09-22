import React, { useEffect, useState } from 'react';
import {
  Edit,
  FileCode,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { Header } from '../components/Header';
import { TemplateDetails, TemplateSummary } from '../types';
import { api } from '../api/client';
import { CodeEditor } from '../components/CodeEditor';
import ComposeStackModal, { ComposeStackSubmit } from '../components/ComposeStackModal';
import DeleteButton from '../components/DeleteButton';

interface TemplatesProps {
  onRefresh: () => void;
  isRefreshing: boolean;
  onStackCreated: (stackName: string) => void;
}

export const Templates: React.FC<TemplatesProps> = ({
  onRefresh,
  isRefreshing,
  onStackCreated,
}) => {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Deploy modal
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDetails | null>(null);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [instantiating, setInstantiating] = useState(false);

  // New template modal
  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [newTemplateId, setNewTemplateId] = useState('');
  const [newTemplateYaml, setNewTemplateYaml] = useState(
`services:
  app:
    image: alpine
    container_name: \${STACK_NAME}-app
    restart: unless-stopped
    ports:
      - "\${SERVICE_PORT:-8080}:80"
`);

  // Edit template modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTemplate, setEditTemplate] = useState<TemplateDetails | null>(null);
  const [editTemplateYaml, setEditTemplateYaml] = useState('');

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const list = await api.listTemplates();
      setTemplates(list);
    } catch (err: any) {
      alert(`Failed to load templates: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleOpenDeploy = async (id: string) => {
    try {
      const details = await api.getTemplate(id);
      setSelectedTemplate(details);
      setShowDeployModal(true);
    } catch (err: any) {
      alert(`Error loading template: ${err.message}`);
    }
  };

  const handleInstantiate = async ({ name, envContent }: ComposeStackSubmit) => {
    if (!selectedTemplate) return;

    try {
      setInstantiating(true);
      await api.instantiateTemplate(selectedTemplate.id, {
        stack_name: name,
        env_content: envContent,
      });
      setShowDeployModal(false);
      onRefresh();
      onStackCreated(name);
    } catch (err: any) {
      alert(`Failed to create stack: ${err.message}`);
    } finally {
      setInstantiating(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!newTemplateId.trim()) {
      alert('Please enter a template name (e.g. my-app)');
      return;
    }
    try {
      await api.saveTemplate(newTemplateId.trim(), newTemplateYaml);
      setShowNewTemplateModal(false);
      setNewTemplateId('');
      fetchTemplates();
    } catch (err: any) {
      alert(`Failed to save template: ${err.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteTemplate(id);
      fetchTemplates();
    } catch (err: any) {
      alert(`Failed to delete template: ${err.message}`);
    }
  };

  const handleOpenEdit = async (id: string) => {
    try {
      const details = await api.getTemplate(id);
      setEditTemplate(details);
      setEditTemplateYaml(details.raw_content);
      setShowEditModal(true);
    } catch (err: any) {
      alert(`Error loading template: ${err.message}`);
    }
  };

  const handleSaveEdit = async () => {
    if (!editTemplate) return;
    try {
      await api.saveTemplate(editTemplate.id, editTemplateYaml);
      setShowEditModal(false);
      setEditTemplate(null);
      fetchTemplates();
    } catch (err: any) {
      alert(`Failed to save template: ${err.message}`);
    }
  };

  return (
    <div>
      <Header
        title="Templates"
        subtitle="Reusable compose files with parameters"
        onRefresh={fetchTemplates}
        isRefreshing={loading || isRefreshing}
        actions={
          <button
            className="btn btn-primary"
            onClick={() => setShowNewTemplateModal(true)}
          >
            <Plus size={16} />
            <span>New Template</span>
          </button>
        }
      />

      <div style={{ marginBottom: '20px', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Templates are user-supplied: drop compose files named <code>&lt;name&gt;.yml</code> into
        the template directory to add your own. Parameters use normal environment variable
        substitution (<code>{'${VAR}'}</code> / <code>{'${VAR:-default}'}</code>) and are
        filled in when you deploy.
      </div>

      {templates.length === 0 && !loading ? (
        <div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <FileCode size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
          <h3>No Templates Found</h3>
          <p style={{ marginTop: '6px', marginBottom: '20px' }}>
            Add .yml compose files to your template directory.
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          {templates.map((tpl, idx) => (
            <div
              key={tpl.id}
              onClick={() => handleOpenDeploy(tpl.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                flexWrap: 'wrap',
                padding: '12px 16px',
                cursor: 'pointer',
                borderBottom: idx === templates.length - 1 ? 'none' : '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <div
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    padding: '8px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    flexShrink: 0,
                    display: 'flex',
                  }}
                >
                  <FileCode size={16} color="var(--primary)" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '1rem', fontWeight: 600 }}>{tpl.name}</div>
                  <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    {tpl.filename}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  className="btn btn-secondary btn-icon"
                  title="Edit template"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenEdit(tpl.id);
                  }}
                >
                  <Edit size={14} />
                </button>
                <DeleteButton
                  title="Delete template"
                  onConfirm={() => handleDelete(tpl.id)}
                />
                <button
                  className="btn btn-primary"
                  style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenDeploy(tpl.id);
                  }}
                >
                  <Sparkles size={13} />
                  <span>Deploy</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Deploy Modal */}
      {showDeployModal && selectedTemplate && (
        <ComposeStackModal
          title={`Deploy ${selectedTemplate.name}`}
          subtitle={selectedTemplate.filename}
          initialName={`${selectedTemplate.id}-1`}
          initialCompose={selectedTemplate.raw_content}
          composeEditable={false}
          submitLabel="Create Stack"
          busy={instantiating}
          onClose={() => setShowDeployModal(false)}
          onSubmit={handleInstantiate}
        />
      )}

      {/* New Template Modal */}
      {showNewTemplateModal && (
        <div className="modal-backdrop" onClick={() => setShowNewTemplateModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '680px' }}>
            <div className="modal-header">
              <h3>New Template</h3>
              <button
                className="btn btn-secondary btn-icon"
                onClick={() => setShowNewTemplateModal(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>
                  Filename (without .yml)
                </label>
                <input
                  type="text"
                  placeholder="e.g. my-app"
                  value={newTemplateId}
                  onChange={(e) => setNewTemplateId(e.target.value)}
                  autoFocus
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>
                  Compose File
                </label>
                <CodeEditor
                  value={newTemplateYaml}
                  onChange={setNewTemplateYaml}
                  language="yaml"
                  height="400px"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowNewTemplateModal(false)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleCreateTemplate}>
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Template Modal */}
      {showEditModal && editTemplate && (
        <div className="modal-backdrop" onClick={() => setShowEditModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '680px' }}>
            <div className="modal-header">
              <div>
                <h3>Edit {editTemplate.name}</h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '2px' }}>
                  {editTemplate.filename}
                </div>
              </div>
              <button
                className="btn btn-secondary btn-icon"
                onClick={() => setShowEditModal(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>
                  Compose File
                </label>
                <CodeEditor
                  value={editTemplateYaml}
                  onChange={setEditTemplateYaml}
                  language="yaml"
                  height="400px"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowEditModal(false)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSaveEdit}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
