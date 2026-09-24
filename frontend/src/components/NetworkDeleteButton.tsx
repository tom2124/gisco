import React, { useState } from 'react';
import { api } from '../api/client';
import DeleteButton from './DeleteButton';
import { getErrorMessage, useToast } from './ToastProvider';

const SYSTEM_NETWORKS = new Set(['bridge', 'host', 'none']);

interface NetworkDeleteButtonProps {
  networkId: string;
  networkName: string;
  onDeleted?: () => void;
}

export const NetworkDeleteButton: React.FC<NetworkDeleteButtonProps> = ({
  networkId,
  networkName,
  onDeleted,
}) => {
  const { showToast } = useToast();
  const [deleting, setDeleting] = useState(false);

  if (SYSTEM_NETWORKS.has(networkName)) return null;

  const handleConfirm = async () => {
    try {
      setDeleting(true);
      await api.removeNetwork(networkId);
      onDeleted?.();
      showToast(`Network ${networkName} deleted.`, 'success');
    } catch (err: unknown) {
      showToast(`Delete failed: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <DeleteButton
      title="Delete Network"
      onConfirm={handleConfirm}
      disabled={deleting}
    />
  );
};

export default NetworkDeleteButton;
