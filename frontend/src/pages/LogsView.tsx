import React, { useEffect, useRef, useState } from 'react';
import { X, Search, ArrowDown, Trash2, Maximize2, Minimize2 } from 'lucide-react';
import { api } from '../api/client';

interface LogsViewProps {
  containerId: string;
  containerName: string;
  onClose: () => void;
}

export const LogsView: React.FC<LogsViewProps> = ({
  containerId,
  containerName,
  onClose,
}) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [tail, setTail] = useState('150');
  const [connected, setConnected] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connectWs = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setLogs([]);

    const wsUrl = api.getLogsWsUrl(containerId, tail, true);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onmessage = (event) => {
      setLogs((prev) => [...prev, event.data]);
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
  };

  useEffect(() => {
    // Defer one task so React StrictMode's mount-cleanup-mount cycle in dev
    // doesn't open (and abort) a throwaway connection on every open — that
    // abort surfaces as a vite "ws proxy socket error" (ECONNRESET).
    const timer = window.setTimeout(() => connectWs(), 0);
    return () => {
      window.clearTimeout(timer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [containerId, tail]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((l) =>
    l.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: isMaximized ? '96vw' : '900px',
          height: isMaximized ? '92vh' : '620px',
          transition: 'all 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="modal-header" style={{ padding: '12px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span
              className={`status-dot ${connected ? 'online' : ''}`}
              title={connected ? 'Live Streaming' : 'Disconnected'}
            />
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
              Logs: {containerName}
            </span>
            <select
              value={tail}
              onChange={(e) => setTail(e.target.value)}
              style={{
                width: 'auto',
                padding: '3px 8px',
                fontSize: '0.78rem',
                height: 'auto',
              }}
            >
              <option value="50">Last 50 lines</option>
              <option value="150">Last 150 lines</option>
              <option value="500">Last 500 lines</option>
              <option value="all">All</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ position: 'relative', width: '180px' }}>
              <input
                type="text"
                placeholder="Filter logs..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                style={{ padding: '4px 10px 4px 28px', fontSize: '0.8rem' }}
              />
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-dim)',
                }}
              />
            </div>

            <button
              className={`btn btn-secondary btn-icon ${autoScroll ? 'active' : ''}`}
              title="Auto scroll"
              onClick={() => setAutoScroll(!autoScroll)}
              style={{
                color: autoScroll ? 'var(--primary)' : 'var(--text-dim)',
              }}
            >
              <ArrowDown size={14} />
            </button>

            <button
              className="btn btn-secondary btn-icon"
              title="Clear buffer"
              onClick={() => setLogs([])}
            >
              <Trash2 size={14} />
            </button>

            <button
              className="btn btn-secondary btn-icon"
              title={isMaximized ? 'Restore' : 'Maximize'}
              onClick={() => setIsMaximized(!isMaximized)}
            >
              {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>

            <button className="btn btn-secondary btn-icon" onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </div>

        <div
          className="font-mono"
          style={{
            flex: 1,
            background: '#060a10',
            padding: '16px',
            overflowY: 'auto',
            fontSize: '0.82rem',
            lineHeight: '1.6',
            color: '#e2e8f0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {filteredLogs.length === 0 ? (
            <div style={{ color: 'var(--text-dim)' }}>
              {logs.length === 0
                ? 'Waiting for container log output...'
                : 'No logs match the filter query.'}
            </div>
          ) : (
            filteredLogs.map((line, idx) => <div key={idx}>{line}</div>)
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};
