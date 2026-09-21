import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { X, Maximize2, Minimize2, RotateCw, Play } from 'lucide-react';
import { api } from '../api/client';

interface TerminalViewProps {
  containerId: string;
  containerName: string;
  onClose: () => void;
  initialCommand?: string;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  containerId,
  containerName,
  onClose,
  initialCommand = '',
}) => {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const termInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [inputShellCmd, setInputShellCmd] = useState(initialCommand);
  const [isMaximized, setIsMaximized] = useState(false);
  const [connected, setConnected] = useState(false);
  const [started, setStarted] = useState(false);

  const initTerminal = (cmd: string) => {
    if (!terminalRef.current) return;

    // Cleanup previous
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (termInstanceRef.current) {
      termInstanceRef.current.dispose();
    }

    setStarted(true);

    // Terminal instance
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 14,
      theme: {
        background: '#090d16',
        foreground: '#f1f5f9',
        cursor: '#38bdf8',
        selectionBackground: 'rgba(56, 189, 248, 0.3)',
        black: '#0f172a',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e2e8f0',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(terminalRef.current);
    fitAddon.fit();

    termInstanceRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln(`\x1b[36m[gisco]\x1b[0m Connecting to container \x1b[32m${containerName}\x1b[0m via ${cmd || 'auto (bash → sh)'}...`);

    // Connect WebSocket
    const wsUrl = api.getTerminalWsUrl(containerId, cmd);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      term.writeln(`\x1b[36m[gisco]\x1b[0m Interactive terminal connected.\r\n`);

      // Send initial resize
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        term.write(event.data);
      } else {
        const buffer = new Uint8Array(event.data);
        term.write(buffer);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setStarted(false);
      term.writeln(`\r\n\x1b[31m[gisco]\x1b[0m Terminal session disconnected.`);
    };

    ws.onerror = () => {
      setConnected(false);
      setStarted(false);
      term.writeln(`\r\n\x1b[31m[gisco]\x1b[0m Connection error. Is the container running?`);
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    const handleWindowResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  };

  useEffect(() => {
    // Auto-start the terminal on mount, deferred one task so React
    // StrictMode's mount-cleanup-mount cycle in dev doesn't open (and abort)
    // a throwaway connection on every open.
    const timer = window.setTimeout(() => initTerminal(initialCommand), 0);
    // Cleanup on unmount
    return () => {
      window.clearTimeout(timer);
      if (wsRef.current) wsRef.current.close();
      if (termInstanceRef.current) termInstanceRef.current.dispose();
    };
  }, []);

  useEffect(() => {
    if (fitAddonRef.current) {
      setTimeout(() => fitAddonRef.current?.fit(), 100);
    }
  }, [isMaximized]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: isMaximized ? '96vw' : '850px',
          height: isMaximized ? '92vh' : '550px',
          transition: 'all 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="modal-header" style={{ padding: '12px 20px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span
                className={`status-dot ${connected ? 'online' : ''}`}
                title={connected ? 'Connected' : 'Disconnected'}
              />
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                Terminal: {containerName}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '16px', paddingLeft: '16px', borderLeft: '1px solid var(--border-subtle)' }}>
                <input
                  type="text"
                  list="shell-options"
                  value={inputShellCmd}
                  onChange={(e) => setInputShellCmd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const newCmd = e.currentTarget.value;
                      setInputShellCmd(newCmd);
                      initTerminal(newCmd);
                    }
                  }}
                  placeholder="auto (bash → sh)"
                  style={{
                    width: 'auto',
                    minWidth: '140px',
                    padding: '4px 8px',
                    fontSize: '0.78rem',
                    height: 'auto',
                    fontFamily: 'var(--font-mono)',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-main)',
                  }}
                />
                <datalist id="shell-options">
                  <option value="/bin/sh" />
                  <option value="/bin/bash" />
                  <option value="/bin/zsh" />
                </datalist>
                <button
                  className="btn btn-primary"
                  title={started ? 'Restart Shell' : 'Start Shell'}
                  onClick={() => {
                    initTerminal(inputShellCmd);
                  }}
                  style={{ padding: '4px 10px', fontSize: '0.78rem', height: 'auto' }}
                >
                  {started ? <RotateCw size={13} /> : <Play size={13} />}
                  <span style={{ marginLeft: '4px' }}>{started ? 'Restart' : 'Start'}</span>
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
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
        </div>

        <div
          ref={terminalRef}
          style={{
            flex: 1,
            background: '#090d16',
            padding: '12px',
            overflow: 'hidden',
            minHeight: 0,
          }}
        />
      </div>
    </div>
  );
};

export default TerminalView;