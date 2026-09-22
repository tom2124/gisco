import React, { useEffect, useState, useRef } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Play,
  Square,
  RotateCw,
  Download,
  Save,
  Terminal,
  FileText,
  Box,
  X,
} from 'lucide-react';
import { StackDetails, ContainerMetrics } from '../types';
import { api } from '../api/client';
import { CodeEditor } from '../components/CodeEditor';
import { ContainerTable } from '../components/ContainerTable';

interface StackDetailProps {
  stackName: string;
  onBack: () => void;
  onOpenTerminal: (containerId: string, containerName: string, command?: string, interactive?: boolean) => void;
  onOpenLogs: (containerId: string, containerName: string) => void;
}

export const StackDetail: React.FC<StackDetailProps> = ({
  stackName,
  onBack,
  onOpenTerminal,
  onOpenLogs,
}) => {
  const [details, setDetails] = useState<StackDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [envText, setEnvText] = useState('');
  const [activeTab, setActiveTab] = useState<'compose' | 'env' | 'containers' | 'logs'>('compose');
  const [actionLogs, setActionLogs] = useState<string[]>([]);
  const [isRunningAction, setIsRunningAction] = useState(false);
  const [metrics, setMetrics] = useState<Record<string, ContainerMetrics>>({});
  const [saveFeedback, setSaveFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const feedbackTimer = useRef<number | null>(null);
  const actionWsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    };
  }, []);

  const fetchDetails = async () => {
    try {
      setLoading(true);
      const data = await api.getStack(stackName);
      setDetails(data);
      setComposeText(data.compose_content);
      setEnvText(data.env_content || '');
      if (data.external) setActiveTab('containers');
    } catch (err: any) {
      alert(`Error loading stack: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
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

  const showFeedback = (kind: 'success' | 'error', text: string) => {
    setSaveFeedback({ kind, text });
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setSaveFeedback(null), 5000);
  };

  const handleSave = async () => {
    if (saving) return;
    try {
      setSaving(true);
      await api.updateStack(stackName, {
        compose_content: composeText,
        env_content: envText.trim() ? envText : undefined,
      });
      showFeedback('success', 'Stack saved — file permissions and ownership preserved.');
      fetchDetails();
    } catch (err: any) {
      showFeedback('error', `Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Ctrl/Cmd+S saves from the editors without scrolling to the header.
  useEffect(() => {
    if (details?.external || (activeTab !== 'compose' && activeTab !== 'env')) return;
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
    setActiveTab('logs');
    setIsRunningAction(true);
    setActionLogs((prev) => [...prev, `\r\n--- Executing 'docker compose ${action}' on ${stackName} ---`]);

    if (actionWsRef.current) {
      actionWsRef.current.close();
    }

    const wsUrl = api.getStackActionWsUrl(stackName, action);
    const ws = new WebSocket(wsUrl);
    actionWsRef.current = ws;

    ws.onmessage = (event) => {
      setActionLogs((prev) => [...prev, event.data]);
    };

    ws.onclose = () => {
      setIsRunningAction(false);
      fetchDetails();
    };

    ws.onerror = () => {
      setActionLogs((prev) => [...prev, `[WebSocket Error: could not stream action]`]);
      setIsRunningAction(false);
    };
  };

  if (loading && !details) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading stack {stackName}...
      </div>
    );
  }

  return (
    <div>
      {/* Navigation & Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
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
            className={`nav-item ${activeTab === 'compose' ? 'active' : ''}`}
            style={{ borderRadius: 'var(--radius-md) var(--radius-md) 0 0' }}
            onClick={() => setActiveTab('compose')}
          >
            <FileText size={16} />
            <span>{details?.compose_file || 'compose.yml'}</span>
          </button>
        )}
        {!details?.external && (
          <button
            className={`nav-item ${activeTab === 'env' ? 'active' : ''}`}
            style={{ borderRadius: 'var(--radius-md) var(--radius-md) 0 0' }}
            onClick={() => setActiveTab('env')}
          >
            <FileText size={16} />
            <span>.env File</span>
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
      {activeTab === 'compose' && (
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            <span>Compose Specification Editor</span>
            <span>Changes are written non-destructively preserving UID/GID permissions</span>
          </div>
          <CodeEditor
            value={composeText}
            onChange={setComposeText}
            language="yaml"
            height="auto"
          />
        </div>
      )}

      {activeTab === 'env' && (
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            <span>Environment Variables (.env)</span>
            <span>Injected into compose file variable interpolations</span>
          </div>
          <CodeEditor
            value={envText}
            onChange={setEnvText}
            language="env"
            height="auto"
            placeholder="# KEY=value"
          />
        </div>
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
          <div
            className="terminal-body font-mono"
            style={{
              maxHeight: '500px',
              overflowY: 'auto',
              fontSize: '0.85rem',
              color: '#38bdf8',
              whiteSpace: 'pre-wrap',
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

      {/* Floating save button: always reachable while editing, no scroll needed */}
      {!details?.external && (activeTab === 'compose' || activeTab === 'env') && (
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
          title={saving ? 'Saving...' : 'Save stack files (Ctrl+S)'}
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 1000,
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
          }}
        >
          <Save size={20} />
        </button>
      )}

      {/* Inline save feedback (replaces the old alert dialog) */}
      {saveFeedback && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1001,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'var(--bg-card, #0f172a)',
            border: `1px solid ${saveFeedback.kind === 'success' ? 'var(--status-running)' : 'var(--status-error)'}`,
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            fontSize: '0.85rem',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
            maxWidth: 'min(90vw, 560px)',
          }}
        >
          {saveFeedback.kind === 'success' ? (
            <CheckCircle2 size={18} color="var(--status-running)" style={{ flexShrink: 0 }} />
          ) : (
            <AlertCircle size={18} color="var(--status-error)" style={{ flexShrink: 0 }} />
          )}
          <span>{saveFeedback.text}</span>
          <button
            className="btn btn-secondary btn-icon"
            onClick={() => setSaveFeedback(null)}
            title="Dismiss"
            style={{ flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
};
