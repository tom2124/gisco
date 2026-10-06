import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, Copy, Plus, Trash2 } from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import { DockableEditorModal, useEditorDock } from './EditorDock';
import { api } from '../api/client';
import {
  CompositionResult,
  TemplateSlot,
  TemplateSlotPlan,
} from '../types';
import { buildEnvContent, interpolateCompose } from '../utils/composeEnv';
import { getErrorMessage } from './ToastProvider';

const MODAL_ID = 'template-stack-composition';

/**
 * Variables compose/docker resolve themselves; never prompt for these.
 *
 * `COMPOSE_PROJECT_NAME` covers the stack name: compose derives it from the
 * project, and it tracks a `-p` override or a renamed project, which a value
 * baked into `.env` at instantiate time cannot.
 */
const isRuntimeVar = (name: string) =>
  name.startsWith('COMPOSE_') ||
  name.startsWith('DOCKER_') ||
  name.startsWith('GISCO_');

interface TemplateStackModalProps {
  /** Templates the user ticked on the Templates page. */
  templateIds: string[];
  onClose: () => void;
  onCreated: (stackName: string) => void;
  /** Surfaced by the caller for its own toast. */
  onNotify: (message: string, kind: 'success' | 'error') => void;
}



/**
 * Create one stack from several templates, including repeated instances of the
 * same template. Everything the merge will contain is shown before creating,
 * and each slot's parameters are prompted for separately using the *final*
 * names the backend assigned.
 */
export const TemplateStackModal: React.FC<TemplateStackModalProps> = ({
  templateIds,
  onClose,
  onCreated,
  onNotify,
}) => {
  const { setEditorDirty } = useEditorDock();

  // Slots carry a stable id for their whole life. React keys must come from
  // this, never from the instance name: the name is editable, so keying on it
  // changed the key mid-keystroke and remounted the slot (losing input focus on
  // every character). Renaming or reordering then cannot steal focus either.
  const nextSlotId = useRef(0);
  const makeSlot = useCallback(
    (template_id: string): TemplateSlot & { uid: number } => ({
      uid: nextSlotId.current++,
      template_id,
      instance: null,
    }),
    []
  );

  // One slot per selected template, un-named to begin with.
  const [slots, setSlots] = useState<(TemplateSlot & { uid: number })[]>(() =>
    templateIds.map((template_id) => makeSlot(template_id))
  );
  const [stackName, setStackName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [autoRename, setAutoRename] = useState(false);
  const [result, setResult] = useState<CompositionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [mergeError, setMergeError] = useState('');
  const [creating, setCreating] = useState(false);

  // Only the parts the merge endpoint cares about. `uid` is local bookkeeping
  // and must not trigger a refetch.
  const slotsKey = useMemo(
    () =>
      JSON.stringify(
        slots.map(({ template_id, instance }) => ({ template_id, instance }))
      ),
    [slots]
  );

  // Ask the backend what the merge looks like whenever the slot list changes.
  // Debounced so typing an instance name doesn't fire a request per keystroke.
  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.mergeTemplates(
          JSON.parse(slotsKey) as TemplateSlot[],
          autoRename ? 'rename' : 'error'
        );
        if (cancelled) return;
        setResult(data);
        setMergeError('');
      } catch (err) {
        if (cancelled) return;
        setResult(null);
        setMergeError(getErrorMessage(err, 'Could not compose templates'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [slotsKey, autoRename]);

  const templateName = useCallback(
    (id: string) => result?.templates.find((t) => t.id === id)?.name ?? id,
    [result]
  );

  const planFor = useCallback(
    (index: number): TemplateSlotPlan | undefined => result?.slots[index],
    [result]
  );

  // Stable per-slot React key. Survives renaming the instance, so the input
  // holding the cursor is never unmounted while it is being typed into.
  const slotKey = (slot: { uid: number }) => `slot-${slot.uid}`;

  const allParamNames = useMemo(() => {
    const names: string[] = [];
    for (const plan of result?.slots ?? []) {
      for (const p of plan.params) {
        if (!names.includes(p)) names.push(p);
      }
    }
    return names;
  }, [result]);

  const suggestion = useMemo(() => {
    if (slots.length === 1) return `${slots[0].template_id}-1`;
    const base = slots
      .map((s) => s.instance || s.template_id)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return `${base || 'stack'}-1`.slice(0, 48);
  }, [slots]);

  // Recomputing the whole preview and pushing it into CodeMirror on every
  // keystroke was the source of the typing lag and heap growth (each update
  // replaced the entire editor document). Debounced so a burst of typing
  // settles into one render.
  const [previewText, setPreviewText] = useState('');
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setPreviewText(result ? interpolateCompose(result.compose, values) : '');
    }, 200);
    return () => window.clearTimeout(handle);
  }, [result, values]);

  // Only write a runtime var when the user actually gave it a value; writing
  // an empty one would break compose's automatic substitution.
  const envNames = useMemo(
    () =>
      allParamNames.filter(
        (n) => !isRuntimeVar(n) || (values[n] ?? '').trim() !== ''
      ),
    [allParamNames, values]
  );

  const envContent = useMemo(
    () => (envNames.length > 0 ? buildEnvContent(envNames, values) : undefined),
    [envNames, values]
  );

  const setValue = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const updateInstance = (index: number, instance: string) =>
    setSlots((prev) =>
      prev.map((s, i) => (i === index ? { ...s, instance: instance || null } : s))
    );

  const addInstance = (templateId: string) =>
    setSlots((prev) => [...prev, makeSlot(templateId)]);

  const removeSlot = (index: number) =>
    setSlots((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  // The modal is always dockable, and "dirty" tracks real unsaved work.
  const touchedName = stackName.trim() !== '' && stackName !== suggestion;
  const touchedValues = Object.values(values).some((v) => v !== '');
  const dirty = touchedName || touchedValues || slots.some((s) => s.instance);

  useEffect(() => {
    setEditorDirty(MODAL_ID, dirty);
  }, [dirty, setEditorDirty]);

  const handleCreate = async () => {
    // Blank falls back to the suggestion, which the create button also shows.
    const name = stackName.trim() || suggestion;
    setCreating(true);
    try {
      await api.instantiateComposition(slots, {
        stack_name: name,
        env_content: envContent,
        on_conflict: autoRename ? 'rename' : 'error',
      });
      onNotify(`Stack ${name} created from ${slots.length} template(s)`, 'success');
      onCreated(name);
    } catch (err) {
      onNotify(getErrorMessage(err, 'Failed to create stack'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const instanceCount = (templateId: string) =>
    slots.filter((s) => s.template_id === templateId).length;

  const footer = (
    <>
      <button className="btn btn-secondary" onClick={onClose}>
        Cancel
      </button>
      <button
        className="btn btn-primary"
        onClick={handleCreate}
        disabled={creating || loading || !result || mergeError !== ''}
        title={
          mergeError
            ? 'Resolve the composition problem first'
            : `Create ${stackName.trim() || suggestion}`
        }
      >
        {creating
          ? 'Creating...'
          : `Create stack · ${stackName.trim() || suggestion}`}
      </button>
    </>
  );

  return (
    <DockableEditorModal
      id={MODAL_ID}
      title="Create stack from templates"
      subtitle={`${slots.length} template slot${slots.length === 1 ? '' : 's'}`}
      canMinimize
      onClose={onClose}
      maxWidth="900px"
      footer={footer}
    >
      <div className="compose-modal-stack">
        {/* ---- Stack name ---- */}
        <div>
          <label className="compose-modal-label" htmlFor="composed-stack-name">
            Stack name <span className="compose-modal-required">*</span>
          </label>
          <input
            id="composed-stack-name"
            type="text"
            placeholder={suggestion}
            value={stackName}
            onChange={(e) => setStackName(e.target.value)}
            autoFocus
          />
          {stackName.trim() === '' && (
            <div className="compose-modal-help">Leave blank to use “{suggestion}”.</div>
          )}
        </div>

        {/* ---- What is being combined ---- */}
        <div>
          <div className="compose-modal-section-head">
            <span className="compose-modal-label">Templates &amp; instances</span>
            <span className="compose-modal-help">
              Use the same template more than once by adding an instance.
            </span>
          </div>

          {mergeError !== '' && (
            <div className="compose-modal-problem">
              <AlertTriangle size={15} />
              <div style={{ whiteSpace: 'pre-wrap' }}>{mergeError}</div>
            </div>
          )}

          {!autoRename && mergeError !== '' && (
            <label className="compose-modal-check">
              <input
                type="checkbox"
                checked={autoRename}
                onChange={(e) => setAutoRename(e.target.checked)}
              />
              <span>
                Rename clashing services, resources and parameters automatically
              </span>
            </label>
          )}

          {loading && result === null && (
            <div className="compose-modal-help">Composing templates…</div>
          )}

          <div className="compose-slot-list">
            {slots.map((slot, index) => {
              const plan = planFor(index);
              const repeated = instanceCount(slot.template_id) > 1;
              const valuesForSlot =
                plan?.params.filter((p) => !isRuntimeVar(p)) ?? [];
              return (
                <div key={slotKey(slot)} className="compose-slot">
                  <div className="compose-slot-head">
                    <span className="compose-slot-name">
                      {templateName(slot.template_id)}
                      {plan?.instance_scoped && (
                        <span className="badge badge-warning">namespaced</span>
                      )}
                    </span>
                    <div className="compose-slot-actions">
                      <button
                        className="btn btn-secondary btn-icon"
                        title={`Add another ${templateName(slot.template_id)} instance`}
                        onClick={() => addInstance(slot.template_id)}
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        className="btn btn-secondary btn-icon"
                        title="Remove this instance"
                        onClick={() => removeSlot(index)}
                        disabled={slots.length <= 1}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <input
                    type="text"
                    placeholder={
                      repeated
                        ? 'Instance name (required to stay independent)'
                        : 'Instance name (optional)'
                    }
                    value={slot.instance ?? ''}
                    onChange={(e) => updateInstance(index, e.target.value)}
                  />

                  {plan && (
                    <div className="compose-slot-services">
                      {(plan.services.length > 0
                        ? plan.services
                        : ['no services']
                      ).map((svc) => (
                        <span key={svc} className="badge badge-neutral">
                          {svc}
                        </span>
                      ))}
                      {Object.entries(plan.renamed_resources).map(([from, to]) => (
                        <span key={from} className="compose-slot-rename">
                          {from} → {to}
                        </span>
                      ))}
                    </div>
                  )}

                  {valuesForSlot.length > 0 && (
                    <div className="compose-slot-params">
                      {valuesForSlot.map((param) => (
                        <ParamField
                          key={param}
                          name={param}
                          value={values[param] ?? ''}
                          onChange={(v) => setValue(param, v)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ---- Auto values ---- */}
        {result &&
          allParamNames.some(isRuntimeVar) && (
            <div className="compose-modal-help">
              <div>
                Supplied by compose/docker and left out of <code>.env</code>{' '}
                unless you set them:{' '}
                {allParamNames.filter(isRuntimeVar).join(', ')}
              </div>
            </div>
          )}

        {result && result.warnings.length > 0 && (
          <div className="compose-modal-warnings">
            {result.warnings.map((w, i) => (
              <div key={i} className="compose-modal-help">
                {w}
              </div>
            ))}
          </div>
        )}

        {/* ---- Resulting compose file ---- */}
        <div>
          <div className="compose-modal-section-head">
            <span className="compose-modal-label">Resulting compose file</span>
            {result && (
              <span className="compose-modal-help">
                {result.slots.reduce((n, s) => n + s.services.length, 0)} service(s)
              </span>
            )}
          </div>
          <CodeEditor
            value={previewText}
            onChange={() => {}}
            language="yaml"
            height="260px"
            readOnly
          />
        </div>
      </div>
    </DockableEditorModal>
  );
};

interface ParamFieldProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
}

const ParamField: React.FC<ParamFieldProps> = ({ name, value, onChange }) => (
  <label className="compose-param-field">
    <span className="compose-param-name">
      {name}
      <button
        className="compose-param-copy"
        title={`Copy $${name} reference`}
        onClick={() => {
          void navigator.clipboard?.writeText(`\${${name}}`);
        }}
      >
        <Copy size={11} />
      </button>
    </span>
    <input
      type="text"
      placeholder="optional"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </label>
);

export default TemplateStackModal;