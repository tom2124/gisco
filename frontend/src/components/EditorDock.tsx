import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';

export interface EditorDockControls {
  isMinimized: boolean;
  isDirty: boolean;
  dockOffset: number;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
}

type EditorRenderer = (controls: EditorDockControls) => ReactNode;

interface EditorSession {
  id: string;
  minimized: boolean;
  dirty: boolean;
  render: EditorRenderer;
}

interface EditorDockContextValue {
  openEditor: (id: string, render: EditorRenderer) => void;
  closeEditor: (id: string) => void;
  setEditorDirty: (id: string, dirty: boolean) => void;
  isEditorMinimized: (id: string) => boolean;
}

const EditorDockContext = createContext<EditorDockContextValue | null>(null);

export const useEditorDock = (): EditorDockContextValue => {
  const context = useContext(EditorDockContext);
  if (!context) throw new Error('useEditorDock must be used inside EditorDockProvider');
  return context;
};

interface EditorDockProviderProps {
  children: ReactNode;
}

export const EditorDockProvider: React.FC<EditorDockProviderProps> = ({ children }) => {
  const [sessions, setSessions] = useState<EditorSession[]>([]);

  const openEditor = useCallback((id: string, render: EditorRenderer) => {
    setSessions((current) => {
      const existing = current.find((session) => session.id === id);
      if (existing) {
        return current.map((session) =>
          session.id === id ? { ...session, render } : session
        );
      }
      return [...current, { id, minimized: false, dirty: false, render }];
    });
  }, []);

  const closeEditor = useCallback((id: string) => {
    setSessions((current) => current.filter((session) => session.id !== id));
  }, []);

  const setEditorDirty = useCallback((id: string, dirty: boolean) => {
    setSessions((current) =>
      current.map((session) =>
        session.id === id && session.dirty !== dirty
          ? { ...session, dirty }
          : session
      )
    );
  }, []);

  const isEditorMinimized = useCallback(
    (id: string) => sessions.some((session) => session.id === id && session.minimized),
    [sessions]
  );

  const value = useMemo(
    () => ({ openEditor, closeEditor, setEditorDirty, isEditorMinimized }),
    [closeEditor, isEditorMinimized, openEditor, setEditorDirty]
  );

  return (
    <EditorDockContext.Provider value={value}>
      {children}
      {sessions.map((session, index) => {
        const dockOffset = sessions
          .slice(0, index)
          .filter((other) => other.minimized).length * 56;
        const controls: EditorDockControls = {
          isMinimized: session.minimized,
          isDirty: session.dirty,
          dockOffset,
          onMinimize: () =>
            setSessions((current) =>
              current.map((item) =>
                item.id === session.id ? { ...item, minimized: true } : item
              )
            ),
          onRestore: () =>
            setSessions((current) =>
              current.map((item) =>
                item.id === session.id ? { ...item, minimized: false } : item
              )
            ),
          onClose: () => closeEditor(session.id),
        };
        return <React.Fragment key={session.id}>{session.render(controls)}</React.Fragment>;
      })}
    </EditorDockContext.Provider>
  );
};

interface DockableEditorModalProps {
  id: string;
  title: string;
  subtitle?: string;
  canMinimize: boolean;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  maxWidth?: string;
}

const EditorModalFrame: React.FC<
  DockableEditorModalProps & { controls: EditorDockControls }
> = ({ title, subtitle, canMinimize, children, footer, maxWidth, controls }) => {
  const { isMinimized, dockOffset, onMinimize, onRestore } = controls;
  const canMinimizeEditor = canMinimize || controls.isDirty;
  const handleBackdropClick = () => {
    if (isMinimized) return;
    if (canMinimizeEditor) {
      onMinimize();
    } else {
      controls.onClose();
    }
  };

  return (
    <div
      className={isMinimized ? 'editor-dock' : 'modal-backdrop'}
      style={isMinimized ? ({ '--editor-dock-offset': `${dockOffset}px` } as React.CSSProperties) : undefined}
      onClick={handleBackdropClick}
    >
      <div
        className={isMinimized ? 'editor-dock-card' : 'modal-card editor-modal-card'}
        style={!isMinimized && maxWidth ? { maxWidth } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3>{title}</h3>
            {subtitle && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '2px' }}>
                {subtitle}
              </div>
            )}
          </div>
          <div className="editor-modal-actions">
            {isMinimized ? (
              <button
                className="btn btn-secondary btn-icon"
                title="Restore editor"
                onClick={onRestore}
              >
                <Maximize2 size={16} />
              </button>
            ) : canMinimizeEditor ? (
              <button
                className="btn btn-secondary btn-icon"
                title="Minimize editor"
                onClick={onMinimize}
              >
                <Minimize2 size={16} />
              </button>
            ) : null}
            <button
              className="btn btn-secondary btn-icon"
              title="Close editor"
              onClick={controls.onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="modal-body editor-modal-body">{children}</div>
        {footer != null && <div className="modal-footer editor-modal-footer">{footer}</div>}
      </div>
    </div>
  );
};

export const DockableEditorModal: React.FC<DockableEditorModalProps> = ({
  id,
  title,
  subtitle,
  canMinimize,
  onClose,
  children,
  footer,
  maxWidth,
}) => {
  const { openEditor, closeEditor, isEditorMinimized } = useEditorDock();
  const minimizedRef = useRef(false);

  useEffect(() => {
    minimizedRef.current = isEditorMinimized(id);
  }, [id, isEditorMinimized]);

  useEffect(() => {
    openEditor(id, (controls) => (
      <EditorModalFrame
        id={id}
        title={title}
        subtitle={subtitle}
        canMinimize={canMinimize}
        onClose={onClose}
        children={children}
        footer={footer}
        maxWidth={maxWidth}
        controls={{
          ...controls,
          onClose: () => {
            closeEditor(id);
            onClose();
          },
        }}
      />
    ));
  }, [
    canMinimize,
    children,
    closeEditor,
    footer,
    id,
    maxWidth,
    onClose,
    openEditor,
    subtitle,
    title,
  ]);

  useEffect(
    () => () => {
      // A minimized editor remains mounted in the global dock even if its
      // source page is navigated away from. Active editors close with the page.
      if (!minimizedRef.current) closeEditor(id);
    },
    [closeEditor, id]
  );

  return null;
};
