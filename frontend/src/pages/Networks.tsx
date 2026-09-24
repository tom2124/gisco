import React, { useEffect, useState } from 'react';
import { Network, Plus } from 'lucide-react';
import { Header } from '../components/Header';
import { NetworkGraph } from '../types';
import { api } from '../api/client';
import NetworkList from '../components/NetworkList';
import SortSelect from '../components/SortSelect';
import type { SortMode } from '../utils/sort';
import { getErrorMessage, useToast } from '../components/ToastProvider';

interface NetworksProps {
  onNavigateToContainers?: () => void;
  onSelectStack?: (stackName: string) => void;
}

export const Networks: React.FC<NetworksProps> = ({ onNavigateToContainers, onSelectStack }) => {
  const { showToast } = useToast();
  const [graph, setGraph] = useState<NetworkGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [netName, setNetName] = useState('');
  const [netDriver, setNetDriver] = useState('bridge');
  const [sortMode, setSortMode] = useState<SortMode>('state');

  const fetchNetworks = async () => {
    try {
      setLoading(true);
      const data = await api.getNetworkTopology();
      setGraph(data);
    } catch (err: unknown) {
      showToast(`Failed to load networks: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNetworks();
  }, []);

  const handleCreate = async () => {
    if (!netName.trim()) {
      showToast('Please enter a network name', 'warning');
      return;
    }

    try {
      await api.createNetwork(netName.trim(), netDriver);
      setShowCreateModal(false);
      setNetName('');
      fetchNetworks();
      showToast(`Network ${netName.trim()} created.`, 'success');
    } catch (err: unknown) {
      showToast(`Network creation failed: ${getErrorMessage(err, 'Unknown error')}`, 'error');
    }
  };

  return (
    <div>
      <Header
        title="Networks"
        subtitle="Networks and their connected containers"
        onRefresh={fetchNetworks}
        isRefreshing={loading}
        actions={
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} />
            <span>Create Network</span>
          </button>
        }
      />

      <div style={{ padding: '16px 0 0' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
          <SortSelect value={sortMode} onChange={setSortMode} />
        </div>
        {loading && !graph ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Network size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
            <p>Loading networks...</p>
          </div>
        ) : !graph || graph.networks.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Network size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
            <h3>No Networks Found</h3>
            <p style={{ marginTop: '6px' }}>No Docker networks found.</p>
          </div>
        ) : (
          <NetworkList
            graph={graph}
            onNetworkDeleted={fetchNetworks}
            onNavigateToContainers={onNavigateToContainers}
            onSelectStack={onSelectStack}
            sortMode={sortMode}
          />
        )}
      </div>

      {/* Create Network Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h3>Create Virtual Network</h3>
              <button
                className="btn btn-secondary btn-icon"
                onClick={() => setShowCreateModal(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>
                  Network Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. internal-net"
                  value={netName}
                  onChange={(e) => setNetName(e.target.value)}
                  autoFocus
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem' }}>
                  Driver
                </label>
                <select
                  value={netDriver}
                  onChange={(e) => setNetDriver(e.target.value)}
                >
                  <option value="bridge">bridge (Isolated software bridge)</option>
                  <option value="macvlan">macvlan (Direct MAC on physical LAN)</option>
                  <option value="ipvlan">ipvlan (Direct IP on physical LAN)</option>
                  <option value="overlay">overlay (Multi-host overlay)</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleCreate}>
                Create Network
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
