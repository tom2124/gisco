import {
  CompositionResult,
  ContainerMetrics,
  ContainerSummary,
  DockerNetwork,
  DockerVolume,
  ImagePruneResult,
  ImageSummary,
  NetworkGraph,
  OnConflict,
  StackDetails,
  StackSummary,
  SystemStatus,
  TemplateDetails,
  TemplateSlot,
  TemplateSummary,
  VolumeUsageSnapshot,
  VolumePruneResult,
} from '../types';

const API_BASE = '/api';
const pathSegment = (value: string) => encodeURIComponent(value);

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    let errMsg = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.error) errMsg = body.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  return res.json();
}

export const api = {
  // System
  getSystemStatus: () => request<SystemStatus>(`${API_BASE}/system/status`),
  pingDocker: () => request<{ status: string }>(`${API_BASE}/system/ping`),

  // Stacks
  listStacks: () => request<StackSummary[]>(`${API_BASE}/stacks`),
  getStack: (name: string) => request<StackDetails>(`${API_BASE}/stacks/${pathSegment(name)}`),
  createStack: (data: {
    name: string;
    compose_content: string;
    env_content?: string;
    custom_uid?: number;
    custom_gid?: number;
  }) =>
    request<{ status: string; name: string }>(`${API_BASE}/stacks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateStack: (
    name: string,
    data: {
      compose_content: string;
      env_content: string;
      custom_uid?: number;
      custom_gid?: number;
    }
  ) =>
    request<{ status: string; name: string }>(`${API_BASE}/stacks/${pathSegment(name)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteStack: (name: string) =>
    request<{ status: string; name: string }>(`${API_BASE}/stacks/${pathSegment(name)}`, {
      method: 'DELETE',
    }),
  triggerStackAction: (name: string, action: string) =>
    request<{ status: string; action: string }>(`${API_BASE}/stacks/${pathSegment(name)}/action`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  // Containers
  listContainers: (all = true) =>
    request<ContainerSummary[]>(`${API_BASE}/containers?all=${all}`),
  inspectContainer: (id: string) => request<any>(`${API_BASE}/containers/${pathSegment(id)}`),
  containerAction: (id: string, action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause') =>
    request<{ status: string; action: string }>(`${API_BASE}/containers/${pathSegment(id)}/${action}`, {
      method: 'POST',
    }),
  removeContainer: (id: string, force = false) =>
    request<{ status: string; id: string }>(`${API_BASE}/containers/${pathSegment(id)}?force=${force}`, {
      method: 'DELETE',
    }),
  getContainerMetrics: (id: string) =>
    request<ContainerMetrics>(`${API_BASE}/containers/${pathSegment(id)}/metrics`),
  /**
   * Stats for many containers in one request, keyed by container id. Ids that
   * could not be sampled are simply absent, so one container exiting mid-poll
   * does not discard the rest of the batch.
   */
  getContainerMetricsBulk: (ids: string[]) =>
    request<{ metrics: Record<string, ContainerMetrics> }>(
      `${API_BASE}/containers/metrics`,
      { method: 'POST', body: JSON.stringify({ ids }) }
    ),

  // Templates
  listTemplates: () => request<TemplateSummary[]>(`${API_BASE}/templates`),
  getTemplate: (id: string) => request<TemplateDetails>(`${API_BASE}/templates/${pathSegment(id)}`),
  instantiateTemplate: (
    id: string,
    data: {
      stack_name: string;
      env_content?: string;
      custom_uid?: number;
      custom_gid?: number;
    }
  ) =>
    request<{ status: string; stack_name: string }>(
      `${API_BASE}/templates/${pathSegment(id)}/instantiate`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),
  saveTemplate: (id: string, content: string, overwrite = true) =>
    request<{ status: string; id: string }>(`${API_BASE}/templates/${pathSegment(id)}`, {
      method: 'POST',
      body: JSON.stringify({ content, overwrite }),
    }),
  deleteTemplate: (id: string) =>
    request<{ status: string; id: string }>(`${API_BASE}/templates/${pathSegment(id)}`, {
      method: 'DELETE',
    }),
  /** Preview the compose file that composing `slots` would produce. No writes. */
  mergeTemplates: (slots: TemplateSlot[], onConflict: OnConflict = 'error') =>
    request<CompositionResult>(`${API_BASE}/templates/composition/merge`, {
      method: 'POST',
      body: JSON.stringify({ slots, on_conflict: onConflict }),
    }),
  /** Compose `slots` into a brand new stack. */
  instantiateComposition: (
    slots: TemplateSlot[],
    data: {
      stack_name: string;
      env_content?: string;
      on_conflict?: OnConflict;
      custom_uid?: number;
      custom_gid?: number;
    }
  ) =>
    request<{ status: string; stack_name: string }>(
      `${API_BASE}/templates/composition/instantiate`,
      { method: 'POST', body: JSON.stringify({ ...data, slots }) }
    ),

  // Networks
  listNetworks: () => request<DockerNetwork[]>(`${API_BASE}/networks`),
  getNetworkTopology: () => request<NetworkGraph>(`${API_BASE}/networks/topology`),
  createNetwork: (name: string, driver?: string) =>
    request<any>(`${API_BASE}/networks`, {
      method: 'POST',
      body: JSON.stringify({ name, driver }),
    }),
  removeNetwork: (id: string) =>
    request<{ status: string; id: string }>(`${API_BASE}/networks/${pathSegment(id)}`, {
      method: 'DELETE',
    }),

  // Images
  listImages: () => request<ImageSummary[]>(`${API_BASE}/images`),
  pullImage: (image: string, tag?: string) =>
    request<{ status: string; image: string }>(`${API_BASE}/images/pull`, {
      method: 'POST',
      body: JSON.stringify({ image, tag }),
    }),
  removeImage: (id: string, force = false) =>
    request<{ status: string; id: string }>(`${API_BASE}/images/${pathSegment(id)}?force=${force}`, {
      method: 'DELETE',
    }),
  pruneImages: (danglingOnly = true) =>
    request<ImagePruneResult>(`${API_BASE}/images/prune?dangling=${danglingOnly}`, {
      method: 'POST',
    }),

  // Volumes
  listVolumes: () => request<DockerVolume[]>(`${API_BASE}/volumes`),
  /**
   * Volume sizes. The backend computes these off the request path because
   * Docker's `df` costs seconds; `pending` is true while a refresh runs, and
   * `values` may be empty or stale until it clears.
   */
  getVolumeUsage: () =>
    request<VolumeUsageSnapshot>(`${API_BASE}/volumes/usage`),
  pruneVolumes: (includeNamed = true) =>
    request<VolumePruneResult>(`${API_BASE}/volumes/prune?all=${includeNamed}`, {
      method: 'POST',
    }),
  removeVolume: (name: string, force = false) =>
    request<{ status: string; name: string }>(`${API_BASE}/volumes/${pathSegment(name)}?force=${force}`, {
      method: 'DELETE',
    }),

  // WebSocket URL helpers
  getTerminalWsUrl: (containerId: string, cmd?: string, interactive?: boolean, user?: string) => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const params = new URLSearchParams();
    if (cmd) params.append('cmd', cmd);
    if (interactive !== undefined) params.append('interactive', interactive.toString());
    if (user) params.append('user', user);
    const query = params.toString() ? `?${params.toString()}` : '';
    return `${proto}//${host}/api/ws/containers/${pathSegment(containerId)}/terminal${query}`;
  },
  getLogsWsUrl: (containerId: string, tail = '100', timestamps = true) => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${proto}//${host}/api/ws/containers/${pathSegment(containerId)}/logs?tail=${tail}&timestamps=${timestamps}`;
  },
  getStatsWsUrl: (containerId: string) => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${proto}//${host}/api/ws/containers/${pathSegment(containerId)}/stats`;
  },
  getStackActionWsUrl: (stackName: string, action: string) => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${proto}//${host}/api/ws/stacks/${pathSegment(stackName)}/action-stream?action=${action}`;
  },
};
