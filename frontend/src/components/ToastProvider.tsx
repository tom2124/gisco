import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  showToast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const ToastIcon = ({ kind }: { kind: ToastKind }) => {
  const props = { size: 18, strokeWidth: 2 };
  if (kind === 'success') return <CheckCircle2 {...props} />;
  if (kind === 'error') return <AlertCircle {...props} />;
  if (kind === 'warning') return <TriangleAlert {...props} />;
  return <Info {...props} />;
};

export const ToastProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef<number[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++nextIdRef.current;
    setToasts((current) => [...current.slice(-4), { id, kind, message }]);

    const duration = kind === 'error' ? 6500 : 4000;
    const timer = window.setTimeout(() => {
      dismissToast(id);
      timersRef.current = timersRef.current.filter((timerId) => timerId !== timer);
    }, duration);
    timersRef.current.push(timer);
  }, [dismissToast]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`} role="status">
            <span className="toast-icon"><ToastIcon kind={toast.kind} /></span>
            <span className="toast-message">{toast.message}</span>
            <button
              className="toast-close"
              onClick={() => dismissToast(toast.id)}
              title="Dismiss notification"
              aria-label="Dismiss notification"
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
};
