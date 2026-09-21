import {
  ContainerMetrics,
  ContainerSummary,
  DockerNetwork,
  DockerVolume,
  ImageSummary,
  NetworkGraph,
  StackDetails,
  StackSummary,
  SystemStatus,
  TemplateDetails,
  TemplateSummary,
} from '../types';

const API_BASE = '/api';

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
  getStack: (name: string) => request<StackDetails>(`${API_BASE}/stacks/${name}`),
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
      env_content?: string;
      custom_uid?: number;
      custom_gid?: number;
    }
  ) =>
    request<{ status: string; name: string }>(`${API_BASE}/stacks/${name}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteStack: (name: string) =>
    request<{ status: string; name: string }>(`${API_BASE}/stacks/${name}`, {
      method: 'DELETE',
    }),
  triggerStackAction: (name: string, action: string) =>
    request<{ status: string; action: string }>(`${API_BASE}/stacks/${name}/action`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  // Containers
  listContainers: (all = true) =>
    request<ContainerSummary[]>(`${API_BASE}/containers?all=${all}`),
  inspectContainer: (id: string) => request<any>(`${API_BASE}/containers/${id}`),
  containerAction: (id: string, action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause') =>
    request<{ status: string; action: string }>(`${API_BASE}/containers/${id}/${action}`, {
      method: 'POST',
    }),
  removeContainer: (id: string, force = false) =>
    request<{ status: string; id: string }>(`${API_BASE}/containers/${id}?force=${force}`, {
      method: 'DELETE',
    }),
  getContainerMetrics: (id: string) =>
    request<ContainerMetrics>(`${API_BASE}/containers/${id}/metrics`),

  // Templates
  listTemplates: () => request<TemplateSummary[]>(`${API_BASE}/templates`),
  getTemplate: (id: string) => request<TemplateDetails>(`${API_BASE}/templates/${id}`),
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
      `${API_BASE}/templates/${id}/instantiate`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),
  saveTemplate: (id: string, content: string) =>
    request<{ status: string; id: string }>(`${API_BASE}/templates/${id}`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  deleteTemplate: (id: string) =>
    request<{ status: string; id: string }>(`${API_BASE}/templates/${id}`, {
      method: 'DELETE',
    }),

  // Networks
  listNetworks: () => request<DockerNetwork[]>(`${API_BASE}/networks`),
  getNetworkTopology: () => request<NetworkGraph>(`${API_BASE}/networks/topology`),
  createNetwork: (name: string, driver?: string) =>
    request<any>(`${API_BASE}/networks`, {
      method: 'POST',
      body: JSON.stringify({ name, driver }),
    }),
  removeNetwork: (id: string) =>
    request<{ status: string; id: string }>(`${API_BASE}/networks/${id}`, {
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
    request<{ status: string; id: string }>(`${API_BASE}/images/${id}?force=${force}`, {
      method: 'DELETE',
    }),

  // Volumes
  listVolumes: () => request<DockerVolume[]>(`${API_BASE}/volumes`),
  removeVolume: (name: string, force = false) =>
    request<{ status: string; name: string }>(`${API_BASE}/volumes/${name}?force=${force}`, {
      method: 'DELETE',
    }),

  // WebSocket URL helpers
  getTerminalWsUrl: (containerId: string, cmd?: string, interactive?: boolean) => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const params = new URLSearchParams();
    if (cmd) params.append('cmd', cmd);
    if (interactive !== undefined) params.append('interactive', interactive.toString());
    const query = params.toString() ? `?${params.toString()}` : '';
    return `${proto}//${host}/api/ws/containers/${containerId}/terminal${query}`;
  },
  getLogsWsUrl: (containerId: string, tail = '100', timestamps = true) => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${proto}//${host}/api/ws/containers/${containerId}/logs?tail=${tail}&timestamps=${timestamps}`;
  },
  getStatsWsUrl: (containerId: string) => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${proto}//${host}/api/ws/containers/${containerId}/stats`;
  },
  getStackActionWsUrl: (stackName: string, action: string) => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${proto}//${host}/api/ws/stacks/${stackName}/action-stream?action=${action}`;
  },
};
