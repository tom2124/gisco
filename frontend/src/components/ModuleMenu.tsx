import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Cpu,
  Database,
  Package,
  Server,
  Settings,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';
import { ContainerModuleAction } from '../types';

const CustomSvgIcon = ({ src, size }: { src: string; size?: number; color?: string }) => (
  <img src={src} alt="" style={{ width: size ?? 14, height: size ?? 14, display: 'inline-block' }} />
);

/**
 * Icons a module may name.
 *
 * The backend names a lucide icon so a module can be written without shipping
 * any SVG of its own. An unknown name falls back to a generic icon rather than
 * rendering nothing.
 */
const MODULE_ICONS: Record<string, React.ElementType> = {
  database: Database,
  server: Server,
  cpu: Cpu,
  package: Package,
  wrench: Wrench,
  settings: Settings,
  box: Box,
  terminal: Terminal,
  sparkles: Sparkles,
  'ignition-standard': (props: { size?: number }) => <CustomSvgIcon src="/ignition-standard.svg" size={props.size} />,
  'ignition-edge': (props: { size?: number }) => <CustomSvgIcon src="/ignition-edge.svg" size={props.size} />,
  'ignition-maker': (props: { size?: number }) => <CustomSvgIcon src="/ignition-maker.svg" size={props.size} />,
  'ignition-cloud': (props: { size?: number }) => <CustomSvgIcon src="/ignition-cloud.svg" size={props.size} />,
};

export type ModuleMenuItem = ContainerModuleAction;

interface ModuleMenuProps {
  /** Tooltip for the button. */
  title: string;
  /** Icon name from the backend. */
  icon: string;
  /** The operations offered. */
  items: ModuleMenuItem[];
  /** Called when the user picks an entry. */
  onSelect: (item: ModuleMenuItem) => void;
  disabled?: boolean;
}

/**
 * A button that opens a menu of module operations.
 *
 * Entries that declare a confirmation run in two steps: picking one shows the
 * prompt in place of the list, so the user can back out without a modal
 * dialog taking over the screen.
 */
export const ModuleMenu: React.FC<ModuleMenuProps> = ({
  title,
  icon,
  items,
  onSelect,
  disabled,
}) => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<ModuleMenuItem | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on a click elsewhere, and on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPending(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setPending(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const Icon = MODULE_ICONS[icon] ?? MODULE_ICONS.package;

  const pick = (item: ModuleMenuItem) => {
    if (item.confirm) {
      setPending(item);
      return;
    }
    onSelect(item);
    setOpen(false);
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        className="btn btn-secondary btn-icon-lg"
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
          setPending(null);
        }}
      >
        <Icon size={36} color="var(--primary)" />
      </button>

      {open && (
        <div
          className="module-menu"
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            zIndex: 'var(--z-dropdown)',
            minWidth: '240px',
            background: 'var(--bg-card)',
            border: 'var(--border-width) solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-modal)',
            padding: 'var(--space-6)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            backdropFilter: 'var(--glass-blur)',
          }}
        >
          {pending ? (
            <>
              <div
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--text-muted)',
                  padding: 'var(--space-8)',
                  whiteSpace: 'normal',
                }}
              >
                {pending.confirm}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-8)', justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: 'var(--space-4) var(--space-12)' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPending(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  style={{ fontSize: '0.75rem', padding: 'var(--space-4) var(--space-12)' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(pending);
                    setOpen(false);
                    setPending(null);
                  }}
                >
                  Run
                </button>
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: 'var(--text-dim)',
                  padding: 'var(--space-4) var(--space-6)',
                  textTransform: 'var(--text-transform-headers)',
                  letterSpacing: '0.06em',
                  whiteSpace: 'nowrap',
                  marginBottom: 'var(--space-2)',
                  textAlign: 'center',
                }}
              >
                {title}
              </div>
              <div
                style={{
                  height: 'var(--border-width)',
                  background: 'var(--border-subtle)',
                  margin: '0 var(--space-2) var(--space-2)',
                  borderRadius: 'var(--radius-full)',
                }}
              />
              {items.map((item) => (
              <button
                key={item.id}
                role="menuitem"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  fontSize: '0.82rem',
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  padding: 'var(--space-8) var(--space-12)',
                  color: item.dangerous ? 'var(--status-error)' : 'var(--text-main)',
                  background: 'transparent',
                  border: 'var(--border-width) solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)',
                  lineHeight: 1.4,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  pick(item);
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--accent-tint)';
                  e.currentTarget.style.borderColor = 'var(--accent-border)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'transparent';
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '20px',
                    height: '20px',
                    flexShrink: 0,
                    marginRight: 'var(--space-8)',
                    color: item.dangerous ? 'var(--status-error)' : 'var(--primary)',
                    opacity: 0.9,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </span>
                {item.label}
              </button>
            ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ModuleMenu;
