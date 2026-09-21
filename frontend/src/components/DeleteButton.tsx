import React, { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

interface DeleteButtonProps {
  title?: string;
  confirmTitle?: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  size?: number;
}

const ARM_TIMEOUT_MS = 3000;

export const DeleteButton: React.FC<DeleteButtonProps> = ({
  title = 'Delete',
  confirmTitle = 'Click again to confirm',
  onConfirm,
  disabled = false,
  size = 14,
}) => {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const disarm = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setArmed(false);
  };

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || busy) return;

    if (!armed) {
      setArmed(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
      return;
    }

    disarm();
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  const isDisabled = disabled || busy;

  return (
    <button
      className="btn btn-secondary btn-icon"
      title={armed ? confirmTitle : title}
      onClick={handleClick}
      onBlur={disarm}
      disabled={isDisabled}
      style={{ opacity: isDisabled && !armed ? 0.5 : 1 }}
    >
      <Trash2 size={size} color={armed ? 'var(--status-error)' : '#fff'} />
    </button>
  );
};

export default DeleteButton;
