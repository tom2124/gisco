import React, { useEffect, useRef, useState } from 'react';
import {
  Edit,
  FileCode,
  Plus,
  Sparkles,
} from 'lucide-react';
import { Header } from '../components/Header';
import { TemplateDetails, TemplateSummary } from '../types';
import { api } from '../api/client';
import { CodeEditor } from '../components/CodeEditor';
import TemplateStackModal from '../components/TemplateStackModal';
import DeleteButton from '../components/DeleteButton';
import { getErrorMessage, useToast } from '../components/ToastProvider';
import { DockableEditorModal, useEditorDock } from '../components/EditorDock';

const NEW_TEMPLATE_INITIAL_YAML = `services:
  app:
    image: alpine
    restart: unless-stopped
    ports:
      - "\${SERVICE_PORT:-8080}:80"
`;

interface NewTemplateEditorContentProps {
  editorId: string;
  onClose: () => void;
  onSave: (templateId: string, yaml: string) => boolean | Promise<boolean>;
}

const NewTemplateEditorContent: React.FC<NewTemplateEditorContentProps> = ({
  editorId,
  onClose,
  onSave,
}) => {
  const [templateId, setTemplateId] = useState('');
  const [yaml, setYaml] = useState(NEW_TEMPLATE_INITIAL_YAML);
  const [saving, setSaving] = useState(false);
  const { setEditorDirty, closeEditor } = useEditorDock();
  const hasChanges = templateId.trim() !== '' || yaml !== NEW_TEMPLATE_INITIAL_YAML;

  useEffect(() => {
    setEditorDirty(editorId, hasChanges);
  }, [editorId, hasChanges, setEditorDirty]);

  const handleClose = () => {
    closeEditor(editorId);
    onClose();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await onSave(templateId, yaml);
      if (saved) {
        closeEditor(editorId);
      } else {
        setSaving(false);
      }
    } catch {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>
          Filename (without .yml)
        </label>
        <input
          type="text"
          placeholder="e.g. my-app"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          autoFocus
        />
      </div>

      <div>
        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>
          Compose File
        </label>
        <CodeEditor value={yaml} onChange={setYaml} language="yaml" height="400px" />
      </div>

      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={handleClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Working...' : 'Save Template'}
        </button>
      </div>
    </div>
  );
};

interface EditTemplateEditorContentProps {
  editorId: string;
  template: TemplateDetails;
  onClose: () => void;
  onSave: (yaml: string) => boolean | Promise<boolean>;
}

const EditTemplateEditorContent: React.FC<EditTemplateEditorContentProps> = ({
  editorId,
  template,
  onClose,
  onSave,
}) => {
  const [yaml, setYaml] = useState(template.raw_content);
  const [saving, setSaving] = useState(false);
  const { setEditorDirty, closeEditor } = useEditorDock();
  const hasChanges = yaml !== template.raw_content;

  useEffect(() => {
    setEditorDirty(editorId, hasChanges);
  }, [editorId, hasChanges, setEditorDirty]);

  const handleClose = () => {
    closeEditor(editorId);
    onClose();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await onSave(yaml);
      if (saved) {
        closeEditor(editorId);
      } else {
        setSaving(false);
      }
    } catch {
      setSaving(false);
    }
  };

  return (
    <div>
      <div>
        <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>
          Compose File
        </label>
        <CodeEditor value={yaml} onChange={setYaml} language="yaml" height="400px" />
      </div>

      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={handleClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Working...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
};

interface TemplatesProps {
  onRefresh: () => void;
  isRefreshing: boolean;
  onStackCreated: (stackName: string) => void;
  /** Row to reveal, set by global search via `#/templates?focus=<id>`. */
  focusId?: string | null;
}

export const Templates: React.FC<TemplatesProps> = ({
  onRefresh,
  isRefreshing,
  onStackCreated,
  focusId,
}) => {
  const { showToast } = useToast();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Multi-template composition: which templates are ticked for the next stack.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showComposeModal, setShowComposeModal] = useState(false);

  // Global search can deep-link to one template; reveal it once it exists.
  const focusRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focusId) return;
    focusRowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusId, templates.length]);

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  // New template modal
  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);

  // Edit template modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTemplate, setEditTemplate] = useState<TemplateDetails | null>(null);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const list = await api.listTemplates();
      setTemplates(list);
    } catch (err: unknown) {
      showToast(`Failed to load templates: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleCreateTemplate = async (templateId: string, yaml: string) => {
    if (!templateId.trim()) {
      showToast('Please enter a template name (e.g. my-app)', 'warning');
      return false;
    }
    try {
      await api.saveTemplate(templateId.trim(), yaml, false);
      setShowNewTemplateModal(false);
      fetchTemplates();
      showToast(`Template ${templateId.trim()} saved.`, 'success');
      return true;
    } catch (err: unknown) {
      showToast(`Failed to save template: ${getErrorMessage(err, 'Unknown error')}`, 'error');
      return false;
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteTemplate(id);
      fetchTemplates();
      showToast(`Template ${id} deleted.`, 'success');
    } catch (err: unknown) {
      showToast(`Failed to delete template: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    }
  };

  const handleOpenEdit = async (id: string) => {
    try {
      const details = await api.getTemplate(id);
      setEditTemplate(details);
      setShowEditModal(true);
    } catch (err: unknown) {
      showToast(`Error loading template: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    }
  };

  const handleSaveEdit = async (yaml: string) => {
    if (!editTemplate) return false;
    try {
      await api.saveTemplate(editTemplate.id, yaml);
      setShowEditModal(false);
      setEditTemplate(null);
      fetchTemplates();
      showToast(`Template ${editTemplate.id} saved.`, 'success');
      return true;
    } catch (err: unknown) {
      showToast(`Failed to save template: ${getErrorMessage(err, 'Unknown error')}`, 'error');
      return false;
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

      <div className="info-banner">
        Templates are user-supplied: drop compose files named <code>&lt;name&gt;.yml</code> into
        the template directory to add your own. Parameters use normal environment variable
        substitution (<code>{'${VAR}'}</code> / <code>{'${VAR:-default}'}</code>) and are
        filled in when you deploy.
      </div>

      {selectedIds.length > 0 && (
        <div className="tpl-selection-bar">
          <span className="tpl-selection-count">
            {selectedIds.length} template{selectedIds.length === 1 ? '' : 's'} selected
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setSelectedIds([])}
            >
              Clear
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setShowComposeModal(true)}
            >
              <Sparkles size={14} />
              <span>Create stack from {selectedIds.length} template{selectedIds.length === 1 ? '' : 's'}</span>
            </button>
          </div>
        </div>
      )}

      {templates.length === 0 && !loading ? (
        <div className="card empty-state">
          <FileCode size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
          <h3>No Templates Found</h3>
          <p style={{ marginTop: '6px', marginBottom: '20px' }}>
            Add .yml compose files to your template directory.
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
          {templates.map((tpl, idx) => (
            <div
              key={tpl.id}
              ref={focusId === tpl.id ? focusRowRef : undefined}
              onClick={() => toggleSelected(tpl.id)}
              data-template-id={tpl.id}
              className={`list-row${idx % 2 === 1 ? ' list-row-alt' : ''}${
                selectedIds.includes(tpl.id) ? ' list-row-selected' : ''
              }${focusId === tpl.id ? ' list-row-focus' : ''}`}
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
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0 }}>
                    <div style={{ fontSize: '1rem', fontWeight: 600, flexShrink: 0 }}>{tpl.name}</div>
                    {tpl.description && (
                      <span
                        title={tpl.description}
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--text-muted)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          minWidth: 0,
                        }}
                      >
                        {tpl.description}
                      </span>
                    )}
                  </div>
                  <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    {tpl.filename}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderLeft: '1px solid var(--border-subtle)', paddingLeft: '16px', flexShrink: 0 }}>
                <input
                  type="checkbox"
                  className="tpl-select"
                  checked={selectedIds.includes(tpl.id)}
                  onChange={(e) => {
                    e.stopPropagation();
                    toggleSelected(tpl.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  title={
                    selectedIds.includes(tpl.id)
                      ? 'Remove from stack composition'
                      : 'Add to stack composition'
                  }
                  aria-label={`Select ${tpl.name}`}
                />
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
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Composed stack from several templates (incl. repeated instances) */}
      {showComposeModal && selectedIds.length > 0 && (
        <TemplateStackModal
          templateIds={selectedIds}
          onClose={() => setShowComposeModal(false)}
          onNotify={(message, kind) => showToast(message, kind)}
          onCreated={(name) => {
            setShowComposeModal(false);
            setSelectedIds([]);
            onRefresh();
            onStackCreated(name);
          }}
        />
      )}

      {/* New Template Modal */}
      {showNewTemplateModal && (
        <DockableEditorModal
          id="template-new"
          title="New Template"
          canMinimize={false}
          onClose={() => setShowNewTemplateModal(false)}
          maxWidth="680px"
          footer={null}
        >
          <NewTemplateEditorContent
            editorId="template-new"
            onClose={() => setShowNewTemplateModal(false)}
            onSave={handleCreateTemplate}
          />
        </DockableEditorModal>
      )}

      {/* Edit Template Modal */}
      {showEditModal && editTemplate && (
        <DockableEditorModal
          id={`template-edit-${editTemplate.id}`}
          title={`Edit ${editTemplate.name}`}
          subtitle={editTemplate.filename}
          canMinimize={false}
          onClose={() => setShowEditModal(false)}
          maxWidth="680px"
          footer={null}
        >
          <EditTemplateEditorContent
            editorId={`template-edit-${editTemplate.id}`}
            template={editTemplate}
            onClose={() => setShowEditModal(false)}
            onSave={handleSaveEdit}
          />
        </DockableEditorModal>
      )}
    </div>
  );
};
