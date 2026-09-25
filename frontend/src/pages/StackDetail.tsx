import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  ArrowLeft,
  Play,
  Square,
  RotateCw,
  Download,
  Save,
  Terminal,
  FileText,
  Box,
} from 'lucide-react';
import { StackDetails, StackContainerInfo, ContainerMetrics } from '../types';
import { api } from '../api/client';
import { CodeEditor } from '../components/CodeEditor';
import { ContainerTable } from '../components/ContainerTable';
import StackContainerDetail from '../components/StackContainerDetail';
import { getErrorMessage, useToast } from '../components/ToastProvider';
import { extractEnvVars } from '../utils/composeEnv';

interface StackDetailProps {
  stackName: string;
  onBack: () => void;
  onOpenTerminal: (containerId: string, containerName: string, command?: string, interactive?: boolean) => void;
  onOpenLogs: (containerId: string, containerName: string) => void;
}

const DEFAULT_EDITOR_SPLIT = 60; // 3:2 compose-to-env ratio
const MIN_EDITOR_SPLIT = 25;
const MAX_EDITOR_SPLIT = 75;
const EDITOR_DIVIDER_WIDTH = 10;

const clampEditorSplit = (value: number) =>
  Math.min(MAX_EDITOR_SPLIT, Math.max(MIN_EDITOR_SPLIT, value));

interface EditorSplitDrag {
  pointerId: number;
  gridLeft: number;
  contentWidth: number;
}

interface ActionHistoryItem {
  id: number;
  action: string;
  status: 'running' | 'success' | 'error';
  startedAt: string;
  finishedAt?: string;
}

const countLines = (value: string) => (value.length === 0 ? 0 : value.split(/\r?\n/).length);

export const StackDetail: React.FC<StackDetailProps> = ({
  stackName,
  onBack,
  onOpenTerminal,
  onOpenLogs,
}) => {
  const { showToast } = useToast();
  const [details, setDetails] = useState<StackDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [envText, setEnvText] = useState('');
  const [lastSavedCompose, setLastSavedCompose] = useState('');
  const [lastSavedEnv, setLastSavedEnv] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'files' | 'containers' | 'logs'>('files');
  const [actionLogs, setActionLogs] = useState<string[]>([]);
  const [actionHistory, setActionHistory] = useState<ActionHistoryItem[]>([]);
  const [isRunningAction, setIsRunningAction] = useState(false);
  const [metrics, setMetrics] = useState<Record<string, ContainerMetrics>>({});
  const [editorSplit, setEditorSplit] = useState(DEFAULT_EDITOR_SPLIT);
  const [isEditorResizing, setIsEditorResizing] = useState(false);
  const actionWsRef = useRef<WebSocket | null>(null);
  const actionFailedRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const editorGridRef = useRef<HTMLDivElement | null>(null);
  const editorDragRef = useRef<EditorSplitDrag | null>(null);

  const isDirty = composeText !== lastSavedCompose || envText !== lastSavedEnv;
  const missingEnvVars = useMemo(() => {
    const definedNames = new Set(
      envText
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
        .filter((name): name is string => Boolean(name))
    );
    return extractEnvVars(composeText).filter(
      (variable) => !variable.auto && !variable.defaultValue && !definedNames.has(variable.name)
    );
  }, [composeText, envText]);

  useEffect(() => {
    return () => {
      if (actionWsRef.current) {
        actionWsRef.current.onclose = null;
        actionWsRef.current.onerror = null;
        actionWsRef.current.close();
        actionWsRef.current = null;
      }
    };
  }, [stackName]);

  const fetchDetails = async (resetEditorSplit = false, savedAt?: string) => {
    try {
      setLoading(true);
      const data = await api.getStack(stackName);
      setDetails(data);
      setComposeText(data.compose_content);
      setEnvText(data.env_content || '');
      setLastSavedCompose(data.compose_content);
      setLastSavedEnv(data.env_content || '');
      if (resetEditorSplit) {
        setLastSavedAt(null);
      }
      if (savedAt) {
        setLastSavedAt(savedAt);
      }
      if (resetEditorSplit) {
        setEditorSplit(data.env_content?.trim() ? DEFAULT_EDITOR_SPLIT : MAX_EDITOR_SPLIT);
      }
      if (data.external) setActiveTab('containers');
    } catch (err: unknown) {
      showToast(`Error loading stack: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setActionHistory([]);
    setActionLogs([]);
    fetchDetails(true);
  }, [stackName]);

  useEffect(() => {
    if (activeTab === 'logs' && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [actionLogs, activeTab]);

  // Poll metrics for running containers in this stack
  useEffect(() => {
    if (!details) return;

    const runningIds = details.containers
      .filter((c) => c.state === 'running')
      .map((c) => c.id);

    if (runningIds.length === 0) return;

    const fetchAllMetrics = async () => {
      for (const id of runningIds) {
        try {
          const m = await api.getContainerMetrics(id);
          setMetrics((prev) => ({ ...prev, [id]: m }));
        } catch {
          // ignore transient metrics failure
        }
      }
    };

    fetchAllMetrics();
    const interval = setInterval(fetchAllMetrics, 4000);
    return () => clearInterval(interval);
  }, [details]);

  const handleSave = async () => {
    if (saving) return;
    try {
      setSaving(true);
      await api.updateStack(stackName, {
        compose_content: composeText,
        env_content: envText,
      });
      const savedAt = new Date().toISOString();
      setLastSavedCompose(composeText);
      setLastSavedEnv(envText);
      setLastSavedAt(savedAt);
      showToast('Stack saved successfully.', 'success');
      await fetchDetails(false, savedAt);
    } catch (err: unknown) {
      showToast(`Save failed: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEditorSplitPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const grid = editorGridRef.current;
    if (!grid || event.button !== 0) return;

    const gridRect = grid.getBoundingClientRect();
    editorDragRef.current = {
      pointerId: event.pointerId,
      gridLeft: gridRect.left,
      contentWidth: Math.max(1, gridRect.width - EDITOR_DIVIDER_WIDTH),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsEditorResizing(true);
    event.preventDefault();
  };

  const handleEditorSplitPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = editorDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const composeWidth = event.clientX - drag.gridLeft - EDITOR_DIVIDER_WIDTH / 2;
    const nextSplit = (composeWidth / drag.contentWidth) * 100;
    setEditorSplit(clampEditorSplit(nextSplit));
  };

  const stopEditorSplitDrag = () => {
    editorDragRef.current = null;
    setIsEditorResizing(false);
  };

  const handleEditorSplitKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 5 : 2;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setEditorSplit((split) => clampEditorSplit(split - step));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setEditorSplit((split) => clampEditorSplit(split + step));
    }
  };

  // Ctrl/Cmd+S saves from the editors without scrolling to the header.
  useEffect(() => {
    if (details?.external || activeTab !== 'files') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const handleActionStream = (action: string) => {
    const runId = Date.now();
    actionFailedRef.current = false;
    setActionHistory((current) => [
      ...current,
      { id: runId, action, status: 'running', startedAt: new Date().toISOString() },
    ]);
    setActiveTab('logs');
    setIsRunningAction(true);
    setActionLogs((prev) => [...prev, `\r\n--- Executing 'docker compose ${action}' on ${stackName} ---`]);
    showToast(`Running docker compose ${action} for ${stackName}…`, 'info');

    if (actionWsRef.current) {
      actionWsRef.current.onclose = null;
      actionWsRef.current.onerror = null;
      actionWsRef.current.close();
    }

    const wsUrl = api.getStackActionWsUrl(stackName, action);
    const ws = new WebSocket(wsUrl);
    actionWsRef.current = ws;

    ws.onmessage = (event) => {
      if (actionWsRef.current === ws && typeof event.data === 'string') {
        if (event.data.includes('[gisco] Error:')) {
          actionFailedRef.current = true;
          setActionHistory((current) =>
            current.map((item) =>
              item.id === runId ? { ...item, status: 'error' } : item
            )
          );
          showToast(event.data.replace('[gisco] Error: ', ''), 'error');
        }
        setActionLogs((prev) => [...prev, event.data]);
      }
    };

    ws.onclose = () => {
      if (actionWsRef.current !== ws) return;
      actionWsRef.current = null;
      setIsRunningAction(false);
      setActionHistory((current) =>
        current.map((item) =>
          item.id === runId
            ? {
                ...item,
                status: actionFailedRef.current ? 'error' : 'success',
                finishedAt: new Date().toISOString(),
              }
            : item
        )
      );
      if (!actionFailedRef.current) showToast(`docker compose ${action} completed.`, 'success');
      fetchDetails();
    };

    ws.onerror = () => {
      if (actionWsRef.current !== ws) return;
      setActionLogs((prev) => [...prev, `[WebSocket Error: could not stream action]`]);
      setIsRunningAction(false);
      setActionHistory((current) =>
        current.map((item) =>
          item.id === runId
            ? { ...item, status: 'error', finishedAt: new Date().toISOString() }
            : item
        )
      );
      showToast('The action stream connection failed.', 'error');
    };
  };

  if (loading && !details) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading stack {stackName}...
      </div>
    );
  }

  return (
    <div>
      {/* Navigation & Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-icon" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2>{stackName}</h2>
            <span
              className={`badge ${
                details?.status === 'Running'
                  ? 'badge-running'
                  : details?.status === 'Partial'
                  ? 'badge-partial'
                  : 'badge-stopped'
              }`}
            >
              {details?.status}
            </span>
            {details?.external && (
              <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                External
              </span>
            )}
          </div>
          <div className="font-mono" style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '4px' }}>
            {details?.external
              ? 'External compose project · not managed by gisco'
              : <>{details?.path} · Owner UID: {details?.file_uid}:{details?.file_gid}</>}
          </div>
          {details?.description && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              {details.description}
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
          {!details?.external && (
            <button
              className="btn btn-primary"
              onClick={() => handleActionStream('up')}
              disabled={isRunningAction}
              title="Deploy stack (docker compose up -d)"
            >
              <Play size={15} />
              <span>Up</span>
            </button>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => handleActionStream('restart')}
            disabled={isRunningAction}
            title="Restart stack containers"
          >
            <RotateCw size={15} />
            <span>Restart</span>
          </button>
          {!details?.external && (
            <button
              className="btn btn-secondary"
              onClick={() => handleActionStream('pull')}
              disabled={isRunningAction}
              title="Pull updated images"
            >
              <Download size={15} />
              <span>Pull</span>
            </button>
          )}
          <button
            className="btn btn-danger"
            onClick={() => handleActionStream('down')}
            disabled={isRunningAction}
            title="Stop and remove containers (docker compose down)"
          >
            <Square size={15} />
            <span>Down</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: '20px',
        }}
      >
        {!details?.external && (
          <button
            className={`nav-item ${activeTab === 'files' ? 'active' : ''}`}
            style={{ borderRadius: 'var(--radius-md) var(--radius-md) 0 0' }}
            onClick={() => setActiveTab('files')}
          >
            <FileText size={16} />
            <span>Files</span>
          </button>
        )}
        <button
          className={`nav-item ${activeTab === 'containers' ? 'active' : ''}`}
          style={{ borderRadius: 'var(--radius-md) var(--radius-md) 0 0' }}
          onClick={() => setActiveTab('containers')}
        >
          <Box size={16} />
          <span>Containers ({details?.containers.length ?? 0})</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'logs' ? 'active' : ''}`}
          style={{ borderRadius: 'var(--radius-md) var(--radius-md) 0 0' }}
          onClick={() => setActiveTab('logs')}
        >
          <Terminal size={16} />
          <span>Action Stream {isRunningAction && '●'}</span>
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'files' && (
        <>
          <div className="stack-files-toolbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span className={`file-state-dot ${isDirty ? 'dirty' : ''}`} />
              <span style={{ fontSize: '0.8rem', color: isDirty ? 'var(--status-warning)' : 'var(--status-running)' }}>
                {isDirty ? 'Unsaved changes' : 'All changes saved'}
              </span>
              {lastSavedAt && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  Saved {new Date(lastSavedAt).toLocaleTimeString()}
                </span>
              )}
              <span
                className={`file-check ${missingEnvVars.length > 0 ? 'warning' : ''}`}
                title="Checks whether required variables referenced by the compose file are defined in .env"
              >
                {missingEnvVars.length > 0
                  ? `Missing env: ${missingEnvVars.map((variable) => variable.name).join(', ')}`
                  : 'Environment references resolved'}
              </span>
            </div>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !isDirty}
              title={saving ? 'Saving...' : isDirty ? 'Save stack files (Ctrl+S)' : 'No changes to save'}
            >
              <Save size={14} />
              <span>{saving ? 'Saving...' : 'Save changes'}</span>
            </button>
          </div>
          <div
            ref={editorGridRef}
          className="stack-file-grid"
          data-resizing={isEditorResizing ? 'true' : undefined}
          style={{
            gridTemplateColumns: `minmax(0, ${editorSplit}fr) ${EDITOR_DIVIDER_WIDTH}px minmax(0, ${100 - editorSplit}fr)`,
          }}
        >
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '8px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              <span>{details?.compose_file || 'compose.yml'}</span>
              <span>{countLines(composeText)} lines · Compose specification</span>
            </div>
            <CodeEditor
              value={composeText}
              onChange={setComposeText}
              language="yaml"
              height="auto"
              maxHeight="max(240px, calc(100vh - 245px))"
            />
          </div>

          <div
            className="stack-file-divider"
            role="separator"
            aria-label="Resize compose and environment editors"
            aria-orientation="vertical"
            aria-valuemin={MIN_EDITOR_SPLIT}
            aria-valuemax={MAX_EDITOR_SPLIT}
            aria-valuenow={Math.round(editorSplit)}
            aria-valuetext={`${Math.round(editorSplit)} percent for compose, ${Math.round(100 - editorSplit)} percent for environment`}
            tabIndex={0}
            title="Drag to resize · double-click to reset to 3:2"
            data-active={isEditorResizing ? 'true' : undefined}
            onPointerDown={handleEditorSplitPointerDown}
            onPointerMove={handleEditorSplitPointerMove}
            onPointerUp={stopEditorSplitDrag}
            onPointerCancel={stopEditorSplitDrag}
            onLostPointerCapture={stopEditorSplitDrag}
            onDoubleClick={() => setEditorSplit(DEFAULT_EDITOR_SPLIT)}
            onKeyDown={handleEditorSplitKeyDown}
          />

          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '8px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              <span>.env</span>
              <span>{countLines(envText)} lines · Environment variables</span>
            </div>
            <CodeEditor
              value={envText}
              onChange={setEnvText}
              language="env"
              height="auto"
              maxHeight="max(240px, calc(100vh - 245px))"
              placeholder="# KEY=value"
            />
            {!envText && (
              <div style={{ marginTop: '8px', color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                No environment variables are currently defined.
              </div>
            )}
          </div>
        </div>
        </>
      )}

      {activeTab === 'containers' && (
        <div>
          <ContainerTable
            containers={details?.containers || []}
            metrics={metrics}
            onOpenTerminal={onOpenTerminal}
            onOpenLogs={onOpenLogs}
            isStackView={true}
            showStackColumn={false}
            groupByStack={false}
            showNetworks={true}
            detailRenderer={(c) => <StackContainerDetail container={c as StackContainerInfo} />}
          />
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="terminal-window" style={{ minHeight: '400px' }}>
          <div className="terminal-header">
            <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              Docker Compose Command Output
            </span>
            {isRunningAction && (
              <span style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>
                Executing...
              </span>
            )}
          </div>
          {actionHistory.length > 0 && (
            <div className="action-history">
              {actionHistory.slice(-5).reverse().map((item) => (
                <div key={item.id} className="action-history-row">
                  <span className="font-mono" style={{ color: 'var(--text-dim)' }}>
                    {new Date(item.startedAt).toLocaleTimeString()}
                  </span>
                  <span style={{ flex: 1 }}>docker compose {item.action}</span>
                  <span className={`badge ${item.status === 'success' ? 'badge-running' : item.status === 'error' ? 'badge-error' : 'badge-warning'}`}>
                    {item.status === 'running' ? 'Running' : item.status === 'success' ? 'Completed' : 'Failed'}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div
            className="terminal-body font-mono"
            style={{
              maxHeight: '500px',
              overflowY: 'auto',
              fontSize: '0.85rem',
              color: '#38bdf8',
              whiteSpace: 'pre-wrap',
              fontFamily: "'Iosevka', 'JetBrains Mono', monospace",
            }}
          >
            {actionLogs.length === 0 ? (
              <span style={{ color: 'var(--text-dim)' }}>
                Ready. Trigger an action (Up, Down, Restart, Pull) to stream output here.
              </span>
            ) : (
              actionLogs.map((line, idx) => <div key={idx}>{line}</div>)
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

    </div>
  );
};
