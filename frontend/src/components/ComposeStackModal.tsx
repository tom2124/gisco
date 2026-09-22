import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import {
  STACK_NAME_VAR,
  buildEnvContent,
  extractEnvVars,
  interpolateCompose,
} from '../utils/composeEnv';

export interface ComposeStackSubmit {
  name: string;
  compose: string;
  /** .env body, or undefined when the compose references no variables. */
  envContent?: string;
}

interface ComposeStackModalProps {
  title: string;
  subtitle?: string;
  initialName: string;
  initialCompose: string;
  /** Stack creation edits the file; template deploy shows it read-only. */
  composeEditable: boolean;
  submitLabel: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (data: ComposeStackSubmit) => void;
}

export const ComposeStackModal: React.FC<ComposeStackModalProps> = ({
  title,
  subtitle,
  initialName,
  initialCompose,
  composeEditable,
  submitLabel,
  busy = false,
  onClose,
  onSubmit,
}) => {
  const [name, setName] = useState(initialName);
  const [compose, setCompose] = useState(initialCompose);
  const [values, setValues] = useState<Record<string, string>>({});

  const vars = useMemo(() => extractEnvVars(compose), [compose]);

  // Effective values: auto-supplied vars (compose/docker pre-defined) are
  // left out while empty so compose resolves them itself; an explicit value
  // overrides. Used for both the preview and the .env body.
  const effectiveValues = useMemo(() => {
    const eff: Record<string, string> = { ...values, [STACK_NAME_VAR]: name.trim() };
    for (const v of vars) {
      if (v.auto && !(eff[v.name] ?? '').trim()) delete eff[v.name];
    }
    return eff;
  }, [vars, values, name]);
  // Keep a value slot per referenced var: preserve user input, seed new
  // vars with their compose defaults, drop unreferenced ones.
  useEffect(() => {
    setValues((prev) => {
      const next: Record<string, string> = {};
      let changed = Object.keys(prev).length !== vars.length;
      for (const v of vars) {
        if (v.name === STACK_NAME_VAR) continue;
        if (v.name in prev) {
          next[v.name] = prev[v.name];
        } else {
          next[v.name] = v.defaultValue;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [vars]);

  const preview = useMemo(
    () => interpolateCompose(compose, effectiveValues),
    [compose, effectiveValues]
  );

  const handleSubmit = () => {
    if (!name.trim()) {
      alert('Please provide a stack name');
      return;
    }
    // Compose lowercases project names; an uppercase stack name would split
    // the stack from its containers (managed-but-empty + external duplicate).
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name.trim())) {
      alert(
        'Invalid stack name: use lowercase letters, digits, dashes and underscores, starting with a letter or digit (docker compose project name rules)'
      );
      return;
    }
    const names = vars
      .map((v) => v.name)
      .filter((n) => n in effectiveValues);
    onSubmit({
      name: name.trim(),
      compose,
      envContent:
        names.length > 0 ? buildEnvContent(names, effectiveValues) : undefined,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '720px' }}>
        <div className="modal-header">
          <div>
            <h3>{title}</h3>
            {subtitle && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '2px' }}>
                {subtitle}
              </div>
            )}
          </div>
          <button className="btn btn-secondary btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '0.85rem' }}>
              Stack Name *
            </label>
            <input
              type="text"
              placeholder="e.g. production-db"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginTop: '4px' }}>
              A directory will be created for this stack in your stacks folder.
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '0.85rem' }}>
              Compose File{composeEditable ? '' : ' (read-only)'}
            </label>
            <CodeEditor
              value={compose}
              onChange={setCompose}
              language="yaml"
              height="260px"
              placeholder="Type or paste your compose file here…"
              readOnly={!composeEditable}
            />
          </div>

          {vars.length > 0 && (
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '0.85rem' }}>
                Environment Variables ({vars.length})
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: '10px',
                }}
              >
                {vars.map((v) =>
                  v.name === STACK_NAME_VAR ? (
                    <div key={v.name}>
                      <label
                        className="font-mono"
                        style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-dim)' }}
                      >
                        {v.name} <span style={{ opacity: 0.7 }}>(= stack name)</span>
                      </label>
                      <input type="text" value={name} disabled readOnly />
                    </div>
                  ) : (
                    <div key={v.name}>
                      <label
                        className="font-mono"
                        style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-dim)' }}
                      >
                        {v.name}
                        {v.auto && (
                          <span className="badge" style={{ fontSize: '0.62rem', marginLeft: '6px' }}>
                            auto · {v.autoSource}
                          </span>
                        )}
                        {v.defaultValue && (
                          <span style={{ opacity: 0.7 }}> (default: {v.defaultValue})</span>
                        )}
                      </label>
                      <input
                        type="text"
                        value={values[v.name] ?? ''}
                        placeholder={
                          v.auto
                            ? `provided by ${v.autoSource} — fill to override`
                            : v.defaultValue || 'required — no default'
                        }
                        title={
                          v.auto
                            ? `Supplied automatically by ${v.autoSource}; left empty it stays out of .env so the automatic value applies`
                            : undefined
                        }
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [v.name]: e.target.value }))
                        }
                      />
                    </div>
                  )
                )}
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginTop: '6px' }}>
                Written to the stack&apos;s <code>.env</code> file and interpolated by compose
                into the file above. Variables marked <span className="badge" style={{ fontSize: '0.62rem' }}>auto</span> are
                supplied by compose/docker themselves and stay out of <code>.env</code> unless
                you fill in an override.
              </div>
            </div>
          )}

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '0.85rem' }}>
              Preview (variables applied)
            </label>
            <CodeEditor
              value={preview}
              onChange={() => {}}
              language="yaml"
              height="200px"
              readOnly
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={busy}>
            <span>{busy ? 'Working...' : submitLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComposeStackModal;
