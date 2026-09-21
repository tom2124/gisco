import React, { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Stacks } from './pages/Stacks';
import { StackDetail } from './pages/StackDetail';
import { Templates } from './pages/Templates';
import { Containers } from './pages/Containers';
import { Images } from './pages/Images';
import { Networks } from './pages/Networks';
import { Volumes } from './pages/Volumes';
import { Settings } from './pages/Settings';
import { TerminalView } from './pages/TerminalView';
import { LogsView } from './pages/LogsView';
import { StackSummary, SystemStatus } from './types';
import { api } from './api/client';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [selectedStackName, setSelectedStackName] = useState<string | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [stacks, setStacks] = useState<StackSummary[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Terminal & Logs modals
  const [terminalTarget, setTerminalTarget] = useState<{
    id: string;
    name: string;
    command: string;
  } | null>(null);
  const [logsTarget, setLogsTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const fetchGlobalData = async () => {
    try {
      setIsRefreshing(true);
      const [sysStatus, stackList] = await Promise.all([
        api.getSystemStatus().catch(() => null),
        api.listStacks().catch(() => []),
      ]);
      setStatus(sysStatus);
      setStacks(stackList);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchGlobalData();
    const interval = setInterval(fetchGlobalData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectTab = (tab: string) => {
    setSelectedStackName(null);
    setCurrentTab(tab);
  };

  const handleSelectStack = (stackName: string) => {
    setSelectedStackName(stackName);
    setCurrentTab('stacks');
  };

  return (
    <div className="app-container">
      <Sidebar
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        status={status}
      />

      <main className="main-content">
        {currentTab === 'dashboard' && (
          <Dashboard
            status={status}
            stacks={stacks}
            onSelectTab={handleSelectTab}
            onSelectStack={handleSelectStack}
            onRefresh={fetchGlobalData}
            isRefreshing={isRefreshing}
          />
        )}

        {currentTab === 'stacks' &&
          (selectedStackName ? (
            <StackDetail
              stackName={selectedStackName}
              onBack={() => setSelectedStackName(null)}
              onOpenTerminal={(id, name, command = '') => setTerminalTarget({ id, name, command })}
              onOpenLogs={(id, name) => setLogsTarget({ id, name })}
            />
          ) : (
            <Stacks
              stacks={stacks}
              onSelectStack={handleSelectStack}
              onRefresh={fetchGlobalData}
              isRefreshing={isRefreshing}
              onSelectTab={handleSelectTab}
            />
          ))}

        {currentTab === 'templates' && (
          <Templates
            onRefresh={fetchGlobalData}
            isRefreshing={isRefreshing}
            onStackCreated={(name) => handleSelectStack(name)}
          />
        )}

        {currentTab === 'containers' && (
          <Containers
            stacks={stacks}
            onRefresh={fetchGlobalData}
            isRefreshing={isRefreshing}
            onOpenTerminal={(id, name, command = '') => setTerminalTarget({ id, name, command })}
            onOpenLogs={(id, name) => setLogsTarget({ id, name })}
            onSelectStack={handleSelectStack}
          />
        )}

        {currentTab === 'networks' && (
          <Networks
            onNavigateToContainers={() => handleSelectTab('containers')}
          />
        )}

        {currentTab === 'images' && <Images />}

        {currentTab === 'volumes' && <Volumes />}

        {currentTab === 'settings' && (
          <Settings
            status={status}
            onRefresh={fetchGlobalData}
            isRefreshing={isRefreshing}
          />
        )}
      </main>

      {/* Interactive Web Terminal Modal */}
      {terminalTarget && (
        <TerminalView
          containerId={terminalTarget.id}
          containerName={terminalTarget.name}
          initialCommand={terminalTarget.command}
          onClose={() => setTerminalTarget(null)}
        />
      )}

      {/* Live Container Logs Modal */}
      {logsTarget && (
        <LogsView
          containerId={logsTarget.id}
          containerName={logsTarget.name}
          onClose={() => setLogsTarget(null)}
        />
      )}
    </div>
  );
};

export default App;
