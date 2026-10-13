import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { ClipboardPaste, Copy, Check, X, Maximize2, Minimize2, Minus, RotateCw, Play } from 'lucide-react';
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

/**
 * Bind clipboard chords on a terminal.
 *
 * These go through `attachCustomKeyEventHandler`, not `onKey`, and the
 * difference is the whole point — it was two separate bugs.
 *
 * `onKey` fires only for keys xterm's keyboard evaluator maps to something.
 * Ctrl+Shift+C and Ctrl+Shift+V map to nothing at all, so `onKey` never fired
 * for them and a handler bound there simply never ran: the conventional copy
 * and paste chords did nothing, silently.
 *
 * And because `onKey` is observational, xterm had already resolved the key and
 * sent it to the shell regardless of what the listener returned. So the one
 * chord that did fire, Ctrl+C, copied the selection *and* delivered SIGINT —
 * killing whatever was running in the container as a side effect of copying.
 *
 * `attachCustomKeyEventHandler` runs on the raw keydown, before that mapping,
 * and returning false stops xterm processing it. Every chord below is seen,
 * and copy and interrupt are mutually exclusive rather than both happening:
 *
 *   Ctrl+C           copies when a selection exists, otherwise interrupts
 *   Ctrl+Shift+C     copies unconditionally
 *   Ctrl+Shift+V     pastes
 *   Shift+Insert     pastes
 */
export const attachClipboardKeys = (term: Terminal, onCopied?: (text: string) => void) => {
  term.attachCustomKeyEventHandler((ev) => {
    // The handler is also consulted for keyup in some builds; only act on keydown.
    if (ev.type !== 'keydown') return true;

    const chord = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();
    const selection = term.getSelection();

    const isCopy =
      (chord && ev.shiftKey && key === 'c') ||
      (chord && !ev.shiftKey && key === 'c' && Boolean(selection)) ||
      (ev.ctrlKey && ev.key === 'Insert');
    if (isCopy) {
      if (selection) {
        ev.preventDefault();
        void copyTextToClipboard(selection).then(() => onCopied?.(selection));
      }
      // Swallow it either way: a copy chord must never also interrupt the shell.
      return false;
    }

    const isPaste = (chord && ev.shiftKey && key === 'v') || (ev.shiftKey && ev.key === 'Insert');
    if (isPaste) {
      ev.preventDefault();
      void readTextFromClipboard()
        .then((text) => {
          if (text) term.paste(text);
        })
        .catch(() => {
          // Clipboard access may be denied; leave the session intact.
        });
      return false;
    }

    return true;
  });
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
  const [justCopied, setJustCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  const copySelection = () => {
    const term = termInstanceRef.current;
    const selection = term?.getSelection();
    if (term && selection) {
      void copyTextToClipboard(selection).then(() => {
        setJustCopied(true);
        if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = window.setTimeout(() => setJustCopied(false), 1500);
      });
    }
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

    // xterm measures its cell size from the resolved font, so the face has to be
    // loaded before the grid is created. `document.fonts.ready` is not enough on
    // its own: it resolves as soon as there is nothing pending, and a @font-face
    // nothing has requested yet is not pending — so the grid would be sized
    // against the fallback and the columns would not line up. Ask for both faces
    // by name first, which forces the load, then wait.
    try {
      await Promise.all([
        document.fonts.load("400 14px 'Iosevka Term'"),
        document.fonts.load("600 14px 'Iosevka Term'"),
      ]);
      await document.fonts.ready;
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
      fontFamily: "'Iosevka Term', 'JetBrains Mono', monospace",
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

    // Clipboard chords. See attachClipboardKeys for why this is a custom key
    // handler rather than an onKey listener.
    attachClipboardKeys(term, () => {
      setJustCopied(true);
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setJustCopied(false), 1500);
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
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
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
          {/* `.modal-header` is `display: flex` (row) in the stylesheet, so the
              rows below need an explicit column wrapper. Without it they become
              side-by-side flex items and the controls wrap inside themselves. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', flex: 1, minWidth: 0 }}>
            {/* Row 1 — identity on the left, terminal actions on the right. They
                share a row because both describe the session: the title names it,
                the actions address it. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-12)',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-12)', minWidth: 0 }}>
                <span
                  className={`status-dot ${connected ? 'online' : ''}`}
                  title={connected ? 'Connected' : 'Disconnected'}
                />
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: '0.95rem',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={`Terminal: ${containerName}`}
                >
                  Terminal: {containerName}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-8)', flexShrink: 0 }}>
                <button
                  className="btn btn-secondary btn-icon"
                  title={justCopied ? 'Copied' : 'Copy selection (Ctrl+C)'}
                  onClick={copySelection}
                  disabled={!hasSelection}
                >
                  {justCopied
                    ? <Check size={14} color="var(--status-running)" />
                    : <Copy size={14} />}
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

            {/* Row 2 — how to start a shell. Left-aligned; the space to its right
                is deliberately left empty rather than stretched. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)', flexWrap: 'wrap' }}>
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
                  // Sized from the input's own layout, not from the character
                  // count: setting this string as the value and reading
                  // scrollWidth puts "Shell (auto: bash → sh)" at 205px, so
                  // anything under that clips the trailing "h)". 30ch clears it
                  // with room to spare, and being font-relative it survives a
                  // typeface change.
                  minWidth: '30ch',
                  padding: 'var(--space-4) var(--space-8)',
                  fontSize: '0.78rem',
                  height: 'auto',
                  fontFamily: 'var(--font-mono)',
                  background: 'var(--bg-input)',
                  border: 'var(--border-width) solid var(--border-subtle)',
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
                  // Sized from the input's own layout, not from the character
                  // count: setting this string as the value and reading
                  // scrollWidth puts "Shell (auto: bash → sh)" at 205px, so
                  // anything under that clips the trailing "h)". 30ch clears it
                  // with room to spare, and being font-relative it survives a
                  // typeface change.
                  minWidth: '30ch',
                  padding: 'var(--space-4) var(--space-8)',
                  fontSize: '0.78rem',
                  height: 'auto',
                  fontFamily: 'var(--font-mono)',
                  background: 'var(--bg-input)',
                  border: 'var(--border-width) solid var(--border-subtle)',
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
                style={{
                  padding: 'var(--space-4) var(--space-12)',
                  fontSize: '0.78rem',
                  height: 'auto',
                  flexShrink: 0,
                }}
              >
                {started ? <RotateCw size={13} /> : <Play size={13} />}
                <span style={{ marginLeft: 'var(--space-4)' }}>{started ? 'Restart' : 'Start'}</span>
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