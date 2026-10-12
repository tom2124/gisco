import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import '@fontsource/iosevka/400.css';
import '@fontsource/iosevka/600.css';
import { ClipboardPaste, Copy, X, Maximize2, Minimize2, Minus, RotateCw, Play } from 'lucide-react';
import { api } from '../api/client';
import { buildTerminalTheme } from '../theme/terminal';
import { useTheme } from '../theme/ThemeProvider';

interface TerminalViewProps {
  containerId: string;
  containerName: string;
  onClose: () => void;
  initialCommand?: string;
  isMinimized?: boolean;
  dockOffset?: number;
  onMinimize?: () => void;
  onRestore?: () => void;
}

export const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy copy path for non-secure/restricted hosts.
    }
  }

  const fallback = document.createElement('textarea');
  fallback.value = text;
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  document.body.appendChild(fallback);
  fallback.focus();
  fallback.select();
  document.execCommand('copy');
  fallback.remove();
};

const readTextFromClipboard = async (): Promise<string> => {
  if (!navigator.clipboard?.readText) return '';
  return navigator.clipboard.readText();
};

const TerminalView: React.FC<TerminalViewProps> = ({
  containerId,
  containerName,
  onClose,
  initialCommand = '',
  isMinimized = false,
  dockOffset = 0,
  onMinimize,
  onRestore,
}) => {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const termInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const { theme } = useTheme();
  const [inputShellCmd, setInputShellCmd] = useState(initialCommand);
  const [inputUser, setInputUser] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);
  const [connected, setConnected] = useState(false);
  const [started, setStarted] = useState(false);
  const [terminalReady, setTerminalReady] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  const copySelection = () => {
    const term = termInstanceRef.current;
    const selection = term?.getSelection();
    if (term && selection) void copyTextToClipboard(selection);
  };

  const pasteClipboard = async () => {
    const term = termInstanceRef.current;
    if (!term) return;
    try {
      const text = await readTextFromClipboard();
      if (text) term.paste(text);
    } catch {
      // Clipboard access may be denied by the browser; leave the session intact.
    }
  };

  const initTerminal = async (cmd: string, user: string) => {
    if (!terminalRef.current) return;

    // xterm measures the cell size from the resolved font. If Iosevka has not
    // loaded yet, the grid is sized for the fallback face and the output looks
    // misaligned/non-monospaced until something else triggers a re-measure.
    try {
      await document.fonts?.ready;
    } catch {
      // Font Loading API unavailable — fall through to the default metrics.
    }
    if (!terminalRef.current) return;

    // Cleanup previous. Detach callbacks first so its delayed close/error
    // event cannot mark a newly initialized terminal as disconnected.
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
    }
    if (termInstanceRef.current) {
      termInstanceRef.current.dispose();
    }

    setTerminalReady(false);
    setHasSelection(false);
    setStarted(true);

    // Terminal instance
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'Iosevka', 'JetBrains Mono', monospace",
      fontSize: 14,
      // Pin weights to the Iosevka faces we actually bundle (400/600).
      // Otherwise bold ANSI text — which color output enables via SGR 1 —
      // resolves against a face we never loaded, and the browser can pick a
      // different fallback, making the grid look non-monospaced.
      fontWeight: '400',
      fontWeightBold: '600',
      // Terminal output must not reflow: tracking changes alter perceived
      // glyph widths even when the underlying font is monospaced.
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: buildTerminalTheme(),
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(terminalRef.current);
    term.onSelectionChange(() => setHasSelection(Boolean(term.getSelection())));
    fitAddon.fit();

    termInstanceRef.current = term;
    fitAddonRef.current = fitAddon;
    setTerminalReady(true);

    term.writeln(`\x1b[36m[gisco]\x1b[0m Connecting to container \x1b[32m${containerName}\x1b[0m via ${cmd || 'auto (bash → sh)'}${user ? ` as ${user}` : ''}...`);

    // Connect WebSocket
    const wsUrl = api.getTerminalWsUrl(containerId, cmd, undefined, user);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      setConnected(true);
      term.writeln(`\x1b[36m[gisco]\x1b[0m Interactive terminal connected.\r\n`);

      // Send initial resize
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      if (typeof event.data === 'string') {
        term.write(event.data);
      } else {
        const buffer = new Uint8Array(event.data);
        term.write(buffer);
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      setConnected(false);
      setStarted(false);
      term.writeln(`\r\n\x1b[31m[gisco]\x1b[0m Terminal session disconnected.`);
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      setConnected(false);
      setStarted(false);
      term.writeln(`\r\n\x1b[31m[gisco]\x1b[0m Connection error. Is the container running?`);
    };

    term.onKey(({ domEvent }) => {
      if (!domEvent.ctrlKey) return false;

      const shortcut = domEvent.key.toLowerCase();
      const selection = term.getSelection();
      // Ctrl+Shift+C is the requested convention, but Firefox reserves it for
      // its Web Console. Ctrl+C copies whenever a selection exists and still
      // sends an interrupt when the terminal has no selection.
      if (shortcut === 'c' && (domEvent.shiftKey || selection)) {
        if (selection) void copyTextToClipboard(selection);
        domEvent.preventDefault();
        return true;
      }
      if (shortcut === 'v' && domEvent.shiftKey) {
        domEvent.preventDefault();
        void readTextFromClipboard()
          .then((text) => {
            if (text) term.paste(text);
          })
          .catch(() => {
            // Clipboard access may be denied by the browser; leave the session intact.
          });
        return true;
      }
      return false;
    });

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
  };

  useEffect(() => {
    // Auto-start the terminal on mount, deferred one task so React
    // StrictMode's mount-cleanup-mount cycle in dev doesn't open (and abort)
    // a throwaway connection on every open.
    const timer = window.setTimeout(() => initTerminal(initialCommand, ''), 0);
    // Cleanup on unmount
    return () => {
      window.clearTimeout(timer);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      if (termInstanceRef.current) termInstanceRef.current.dispose();
    };
  }, []);

  // Re-read the terminal's colours when the app theme changes. xterm resolves
  // its palette at construction time, so it needs to be told explicitly; the
  // tokens are read again rather than reused because their values differ per
  // theme. `theme` is a dependency only to trigger the re-read.
  useEffect(() => {
    const term = termInstanceRef.current;
    if (term) term.options.theme = buildTerminalTheme();
  }, [theme]);

  useEffect(() => {
    const terminalElement = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminalElement || !fitAddon) return;

    const fitTerminal = () => {
      if (isMinimized) return;
      window.requestAnimationFrame(() => {
        if (isMinimized) return;
        fitAddon.fit();
        const term = termInstanceRef.current;
        if (term) term.refresh(0, Math.max(0, term.rows - 1));
      });
    };

    // The modal animates between its normal and maximized dimensions. Observe
    // the actual terminal container so xterm is refit at every step, including
    // the final collapsed size, instead of leaving rows from the larger view
    // below the visible area.
    const resizeObserver = new ResizeObserver(fitTerminal);
    resizeObserver.observe(terminalElement);
    window.addEventListener('resize', fitTerminal);
    fitTerminal();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', fitTerminal);
    };
  }, [isMaximized, isMinimized, terminalReady]);

  return (
    <div
      className={isMinimized ? 'terminal-dock' : 'modal-backdrop'}
      onClick={isMinimized ? undefined : onMinimize ?? onClose}
      style={isMinimized
        ? ({ '--terminal-dock-offset': `${dockOffset}px` } as React.CSSProperties)
        : undefined}
    >
      <div
        className={isMinimized ? 'terminal-dock-card' : 'modal-card'}
        onClick={(e) => e.stopPropagation()}
        style={isMinimized ? undefined : {
          maxWidth: isMaximized ? '96vw' : '850px',
          height: isMaximized ? '92vh' : '550px',
          transition: 'max-width var(--duration-base) var(--ease-standard), height var(--duration-base) var(--ease-standard)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {isMinimized ? (
          <div className="terminal-dock-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-12)', minWidth: 0 }}>
              <span
                className={`status-dot ${connected ? 'online' : ''}`}
                title={connected ? 'Connected' : 'Disconnected'}
              />
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Terminal: {containerName}
              </span>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                {connected ? 'Live' : started ? 'Starting…' : 'Disconnected'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-8)', flexShrink: 0 }}>
              <button
                className="btn btn-secondary btn-icon"
                title="Restore terminal"
                onClick={onRestore}
              >
                <Maximize2 size={14} />
              </button>
              <button className="btn btn-secondary btn-icon" title="Close terminal" onClick={onClose}>
                <X size={14} />
              </button>
            </div>
          </div>
        ) : (
        <div className="modal-header" style={{ padding: 'var(--space-12) var(--space-12)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-12)', flex: 1, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-12)' }}>
              <span
                className={`status-dot ${connected ? 'online' : ''}`}
                title={connected ? 'Connected' : 'Disconnected'}
              />
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                Terminal: {containerName}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)', marginLeft: 'var(--space-16)', paddingLeft: 'var(--space-16)', borderLeft: '1px solid var(--border-subtle)' }}>
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
                      initTerminal(newCmd, inputUser);
                    }
                  }}
                  placeholder="Shell (auto: bash → sh)"
                  title="Shell to execute (empty = auto: bash, fallback sh)"
                  style={{
                    width: 'auto',
                    minWidth: '130px',
                    padding: 'var(--space-4) var(--space-8)',
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
                <input
                  type="text"
                  list="user-options"
                  value={inputUser}
                  onChange={(e) => setInputUser(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const newUser = e.currentTarget.value;
                      setInputUser(newUser);
                      initTerminal(inputShellCmd, newUser);
                    }
                  }}
                  placeholder="User (auto)"
                  title="User to execute as (empty = container default)"
                  style={{
                    width: 'auto',
                    minWidth: '90px',
                    padding: 'var(--space-4) var(--space-8)',
                    fontSize: '0.78rem',
                    height: 'auto',
                    fontFamily: 'var(--font-mono)',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-main)',
                  }}
                />
                <datalist id="user-options">
                  <option value="root" />
                </datalist>
                <button
                  className="btn btn-primary"
                  title={started ? 'Restart Shell' : 'Start Shell'}
                  onClick={() => {
                    initTerminal(inputShellCmd, inputUser);
                  }}
                  style={{ padding: 'var(--space-4) var(--space-12)', fontSize: '0.78rem', height: 'auto' }}
                >
                  {started ? <RotateCw size={13} /> : <Play size={13} />}
                  <span style={{ marginLeft: 'var(--space-4)' }}>{started ? 'Restart' : 'Start'}</span>
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-8)' }}>
              <button
                className="btn btn-secondary btn-icon"
                title="Copy selection (Ctrl+C)"
                onClick={copySelection}
                disabled={!hasSelection}
              >
                <Copy size={14} />
              </button>
              <button
                className="btn btn-secondary btn-icon"
                title="Paste clipboard (Ctrl+Shift+V)"
                onClick={pasteClipboard}
              >
                <ClipboardPaste size={14} />
              </button>
              <button
                className="btn btn-secondary btn-icon"
                title="Minimize terminal"
                onClick={onMinimize}
              >
                <Minus size={14} />
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
        </div>
        )}

        <div
          className="terminal-view-body"
          style={{
            flex: 1,
            background: 'var(--terminal-surface)',
            padding: 'var(--space-12)',
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          <div ref={terminalRef} className="terminal-host" />
        </div>
      </div>
    </div>
  );
};

export default TerminalView;