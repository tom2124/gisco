import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyableProps {
  /** Text written to the clipboard on click. */
  text: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts / older browsers.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Click-to-copy wrapper with a copy/check icon and "copied" feedback.
 * Stops propagation so it can live inside clickable rows/cards.
 */
export const Copyable: React.FC<CopyableProps> = ({ text, children, style }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await copyText(text)) {
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <span
      role="button"
      tabIndex={0}
      title={copied ? 'Copied!' : `Copy ${text}`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          handleClick(e as unknown as React.MouseEvent);
        }
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        cursor: 'pointer',
        ...style,
      }}
    >
      {children}
      {copied ? (
        <Check size={12} color="var(--status-running)" style={{ flexShrink: 0 }} />
      ) : (
        <Copy size={12} color="var(--text-dim)" style={{ flexShrink: 0, opacity: 0.7 }} />
      )}
    </span>
  );
};

export default Copyable;
