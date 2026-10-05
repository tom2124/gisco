import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { StackSummary, SystemStatus } from './types';
import { api } from './api/client';
import { getErrorMessage, useToast } from './components/ToastProvider';

const Dashboard = lazy(() => import('./pages/Dashboard').then(({ Dashboard }) => ({ default: Dashboard })));
const Stacks = lazy(() => import('./pages/Stacks').then(({ Stacks }) => ({ default: Stacks })));
const StackDetail = lazy(() => import('./pages/StackDetail').then(({ StackDetail }) => ({ default: StackDetail })));
const Templates = lazy(() => import('./pages/Templates').then(({ Templates }) => ({ default: Templates })));
const Containers = lazy(() => import('./pages/Containers').then(({ Containers }) => ({ default: Containers })));
const Images = lazy(() => import('./pages/Images').then(({ Images }) => ({ default: Images })));
const Networks = lazy(() => import('./pages/Networks').then(({ Networks }) => ({ default: Networks })));
const Volumes = lazy(() => import('./pages/Volumes').then(({ Volumes }) => ({ default: Volumes })));
const Settings = lazy(() => import('./pages/Settings').then(({ Settings }) => ({ default: Settings })));
const TerminalView = lazy(() => import('./pages/TerminalView'));
const LogsView = lazy(() => import('./pages/LogsView').then(({ LogsView }) => ({ default: LogsView })));

const RouteLoading = () => (
  <div className="route-loading" role="status">
    Loading view…
  </div>
);

const ModalLoading = () => (
  <div className="modal-backdrop">
    <div className="modal-card route-loading" role="status">
      Loading…
    </div>
  </div>
);

interface TerminalSession {
  id: string;
  name: string;
  command: string;
  minimized: boolean;
}

const VALID_TABS = new Set([
  'dashboard',
  'stacks',
  'templates',
  'containers',
  'images',
  'networks',
  'volumes',
  'settings',
]);

function parseHash(): { tab: string; stackName: string | null } {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/');
  const tab = VALID_TABS.has(parts[0]) ? parts[0] : 'dashboard';
  let stackName: string | null = null;
  if (tab === 'stacks' && parts[1]) {
    try {
      stackName = decodeURIComponent(parts[1]);
    } catch {
      // Ignore malformed percent escapes and fall back to the stacks list.
    }
  }
  return { tab, stackName };
}

export const App: React.FC = () => {
  // Hash routing (#/stacks/foo): the fragment never reaches the server, so
  // this survives refresh and back/forward with zero backend changes.
  const [route, setRoute] = useState(parseHash);
  const { tab: currentTab, stackName: selectedStackName } = route;
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [stacks, setStacks] = useState<StackSummary[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const lastGlobalErrorRef = useRef('');
  // Bumped on every completed global refresh so pages that own extra data
  // (the dashboard) can re-sync without polling on their own.
  const [globalRefreshToken, setGlobalRefreshToken] = useState(0);
  const { showToast } = useToast();

  // Terminal & Logs modals
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([]);
  const [logsTarget, setLogsTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const fetchGlobalData = async () => {
    // Coalesce instead of dropping. A refresh requested while another is in
    // flight (e.g. right after a stack action finishes) used to be discarded,
    // leaving the UI stale until the next 10s tick -- and if a request ever
    // hung, the `finally` below never ran and polling was dead until reload.
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }
    refreshInFlightRef.current = true;
    try {
      setIsRefreshing(true);
      const [systemResult, stacksResult] = await Promise.allSettled([
        api.getSystemStatus(),
        api.listStacks(),
      ]);
      setStatus(systemResult.status === 'fulfilled' ? systemResult.value : null);
      setStacks(stacksResult.status === 'fulfilled' ? stacksResult.value : []);

      const errors: string[] = [];
      if (systemResult.status === 'rejected') {
        errors.push(`Status: ${getErrorMessage(systemResult.reason, 'Unknown error')}`);
      }
      if (stacksResult.status === 'rejected') {
        errors.push(`Stacks: ${getErrorMessage(stacksResult.reason, 'Unknown error')}`);
      }
      if (errors.length > 0) {
        const message = `Background refresh failed — ${errors.join('; ')}`;
        if (lastGlobalErrorRef.current !== message) {
          showToast(message, 'error');
          lastGlobalErrorRef.current = message;
        }
      } else {
        lastGlobalErrorRef.current = '';
      }
      setGlobalRefreshToken((token) => token + 1);
    } finally {
      refreshInFlightRef.current = false;
      // Replay anything that asked for a refresh while we were busy.
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        void fetchGlobalData();
      }
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchGlobalData();
    const interval = setInterval(fetchGlobalData, 10000);
    return () => clearInterval(interval);
  }, []);

  // Warm the one genuinely slow endpoint while the user reads the dashboard.
  // Volume sizes come from Docker's `/system/df`, which walks every image and
  // costs seconds on a cold cache. Kicking it off here means the Volumes page
  // usually finds the numbers already waiting, and because the backend now
  // computes in the background this request returns immediately either way.
  useEffect(() => {
    const warm = window.setTimeout(() => {
      void api.getVolumeUsage().catch(() => {
        /* Warm-up is best effort; the Volumes page retries on its own. */
      });
    }, 2000);
    return () => window.clearTimeout(warm);
  }, []);

  // Re-sync whenever a route change lands on a page that reads global data,
  // so navigating back from a detail view never shows pre-action state while
  // waiting for the next poll tick.
  const lastRouteKeyRef = useRef(`${currentTab}/${selectedStackName ?? ''}`);
  useEffect(() => {
    const routeKey = `${currentTab}/${selectedStackName ?? ''}`;
    if (routeKey === lastRouteKeyRef.current) return;
    lastRouteKeyRef.current = routeKey;
    fetchGlobalData();
  }, [currentTab, selectedStackName]);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (tab: string, stackName: string | null = null) => {
    const hash =
      tab === 'stacks' && stackName
        ? `#/stacks/${encodeURIComponent(stackName)}`
        : `#/${tab}`;
    if (window.location.hash === hash) {
      setRoute({ tab, stackName });
    } else {
      window.location.hash = hash;
    }
  };

  const handleSelectTab = (tab: string) => {
    navigate(tab);
  };

  const handleSelectStack = (stackName: string) => {
    navigate('stacks', stackName);
  };

  const openTerminal = (id: string, name: string, command = '') => {
    setTerminalSessions((current) => {
      const existing = current.find((session) => session.id === id);
      if (existing) {
        return current.map((session) =>
          session.id === id ? { ...session, command, minimized: false } : session
        );
      }

      // Keep every existing exec mounted, but only leave the newly requested
      // terminal in the foreground. This preserves each session's shell and
      // WebSocket while the user browses other pages.
      return [
        ...current.map((session) => ({ ...session, minimized: true })),
        { id, name, command, minimized: false },
      ];
    });
  };

  const minimizeTerminal = (id: string) => {
    setTerminalSessions((current) =>
      current.map((session) => (session.id === id ? { ...session, minimized: true } : session))
    );
  };

  const restoreTerminal = (id: string) => {
    setTerminalSessions((current) =>
      current.map((session) => (session.id === id ? { ...session, minimized: false } : session))
    );
  };

  const closeTerminal = (id: string) => {
    setTerminalSessions((current) => current.filter((session) => session.id !== id));
  };

  const minimizedTerminalCount = terminalSessions.filter((session) => session.minimized).length;

  return (
    <div
      className="app-container"
      style={
        {
          '--terminal-dock-height': `${minimizedTerminalCount * 56}px`,
        } as React.CSSProperties
      }
    >
      <Sidebar
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        status={status}
      />

      <main className="main-content">
        <Suspense fallback={<RouteLoading />}>
        {currentTab === 'dashboard' && (
          <Dashboard
            status={status}
            stacks={stacks}
            onSelectTab={handleSelectTab}
            onSelectStack={handleSelectStack}
            onRefresh={fetchGlobalData}
            isRefreshing={isRefreshing}
            refreshToken={globalRefreshToken}
          />
        )}

        {currentTab === 'stacks' &&
          (selectedStackName ? (
            <StackDetail
              stackName={selectedStackName}
              onBack={() => handleSelectTab('stacks')}
              onOpenTerminal={openTerminal}
              onOpenLogs={(id, name) => setLogsTarget({ id, name })}
              onRefresh={fetchGlobalData}
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
            onOpenTerminal={openTerminal}
            onOpenLogs={(id, name) => setLogsTarget({ id, name })}
            onSelectStack={handleSelectStack}
          />
        )}

        {currentTab === 'networks' && (
          <Networks
            onNavigateToContainers={() => handleSelectTab('containers')}
            onSelectStack={handleSelectStack}
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
        </Suspense>
      </main>

      {/* Keep every terminal mounted so minimized sessions stay interactive. */}
      {terminalSessions.map((session, index) => {
        const dockOffset =
          terminalSessions
            .slice(0, index)
            .filter((other) => other.minimized).length * 56;

        return (
          <Suspense key={session.id} fallback={<ModalLoading />}>
            <TerminalView
              key={session.id}
              containerId={session.id}
              containerName={session.name}
              initialCommand={session.command}
              onClose={() => closeTerminal(session.id)}
              isMinimized={session.minimized}
              onMinimize={() => minimizeTerminal(session.id)}
              onRestore={() => restoreTerminal(session.id)}
              dockOffset={dockOffset}
            />
          </Suspense>
        );
      })}

      {/* Live Container Logs Modal */}
      {logsTarget && (
        <Suspense fallback={<ModalLoading />}>
          <LogsView
            containerId={logsTarget.id}
            containerName={logsTarget.name}
            onClose={() => setLogsTarget(null)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default App;
