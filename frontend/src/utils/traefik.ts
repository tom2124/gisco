export interface TraefikRouter {
  name: string;
  protocol: 'http' | 'tcp';
  rule: string;
  hosts: string[];
  entrypoints: string[];
  tls: boolean;
  service: string;
  middlewares: string[];
}

export interface TraefikService {
  name: string;
  port: string;
}

export interface TraefikInfo {
  enabled: boolean;
  routers: TraefikRouter[];
  services: TraefikService[];
}

const TRAEFIK_PREFIX = 'traefik.';

/** Extract `Host(...)` / `HostSNI(...)` hostnames from a router rule. */
export function hostsFromRule(rule: string): string[] {
  const hosts: string[] = [];
  const re = /(?:Host|HostSNI)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rule)) !== null) {
    for (const part of m[1].split(',')) {
      const host = part.trim().replace(/^[`'"]+|[`'"]+$/g, '');
      if (host && !hosts.includes(host)) hosts.push(host);
    }
  }
  return hosts;
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Parse Docker labels into Traefik routing info.
 * Returns null when the container has no `traefik.*` labels.
 */
export function parseTraefikLabels(
  labels: Record<string, string> | undefined | null
): TraefikInfo | null {
  if (!labels) return null;
  const entries = Object.entries(labels).filter(([k]) =>
    k.startsWith(TRAEFIK_PREFIX)
  );
  if (entries.length === 0) return null;

  const byKey = new Map(entries);
  const enabled = (byKey.get('traefik.enable') ?? 'true').toLowerCase() !== 'false';

  interface RouterDraft {
    name: string;
    protocol: 'http' | 'tcp';
    rule: string;
    entrypoints: string;
    service: string;
    middlewares: string;
    tls: boolean;
  }
  const drafts = new Map<string, RouterDraft>();

  for (const [key, value] of entries) {
    const m = key.match(/^traefik\.(http|tcp)\.routers\.([^.]+)\.(.+)$/);
    if (!m) continue;
    const [, protocol, name, prop] = m as [string, 'http' | 'tcp', string, string];
    const id = `${protocol}/${name}`;
    let draft = drafts.get(id);
    if (!draft) {
      draft = { name, protocol, rule: '', entrypoints: '', service: '', middlewares: '', tls: false };
      drafts.set(id, draft);
    }
    if (prop === 'rule') draft.rule = value;
    else if (prop === 'entrypoints') draft.entrypoints = value;
    else if (prop === 'service') draft.service = value;
    else if (prop === 'middlewares') draft.middlewares = value;
    else if (prop === 'tls' || prop.startsWith('tls.')) {
      draft.tls = prop === 'tls' ? value.toLowerCase() !== 'false' : true;
    }
  }

  const routers: TraefikRouter[] = [...drafts.values()].map((d) => ({
    name: d.name,
    protocol: d.protocol,
    rule: d.rule,
    hosts: hostsFromRule(d.rule),
    entrypoints: splitCsv(d.entrypoints),
    tls: d.tls,
    service: d.service,
    middlewares: splitCsv(d.middlewares),
  }));
  routers.sort((a, b) => a.name.localeCompare(b.name));

  const services: TraefikService[] = [];
  for (const [key, value] of entries) {
    const m = key.match(/^traefik\.http\.services\.([^.]+)\.loadbalancer\.server\.port$/);
    if (m && !services.some((s) => s.name === m[1])) {
      services.push({ name: m[1], port: value });
    }
  }
  services.sort((a, b) => a.name.localeCompare(b.name));

  return { enabled, routers, services };
}
