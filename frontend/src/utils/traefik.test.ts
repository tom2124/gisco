import { describe, expect, it } from 'vitest';
import { hostsFromRule, parseTraefikLabels } from './traefik';

const LABELS = {
  'traefik.enable': 'true',
  'traefik.http.routers.web.rule': 'Host(`app.example.com`, `www.example.com`)',
  'traefik.http.routers.web.entrypoints': 'websecure',
  'traefik.http.routers.web.tls.certresolver': 'letsencrypt',
  'traefik.http.routers.web.middlewares': 'auth, compress',
  'traefik.http.routers.web.service': 'web-svc',
  'traefik.http.services.web-svc.loadbalancer.server.port': '8080',
  'traefik.http.routers.api.rule': 'Host(`api.example.com`) && PathPrefix(`/v1`)',
  'traefik.http.routers.api.tls': 'true',
  'traefik.tcp.routers.mqtt.rule': 'HostSNI(`mqtt.example.com`)',
  'com.docker.compose.project': 'demo',
};

describe('parseTraefikLabels', () => {
  it('parses routers, hosts, entrypoints, tls, service and middlewares', () => {
    const info = parseTraefikLabels(LABELS);
    expect(info).not.toBeNull();
    expect(info!.enabled).toBe(true);
    expect(info!.routers.map((r) => r.name).sort()).toEqual(['api', 'mqtt', 'web']);

    const web = info!.routers.find((r) => r.name === 'web')!;
    expect(web.hosts).toEqual(['app.example.com', 'www.example.com']);
    expect(web.entrypoints).toEqual(['websecure']);
    expect(web.tls).toBe(true);
    expect(web.service).toBe('web-svc');
    expect(web.middlewares).toEqual(['auth', 'compress']);
    expect(info!.services).toEqual([{ name: 'web-svc', port: '8080' }]);
  });

  it('handles tcp HostSNI rules', () => {
    const info = parseTraefikLabels(LABELS)!;
    const mqtt = info.routers.find((r) => r.name === 'mqtt')!;
    expect(mqtt.protocol).toBe('tcp');
    expect(mqtt.hosts).toEqual(['mqtt.example.com']);
  });

  it('returns null without traefik labels', () => {
    expect(parseTraefikLabels({ 'com.docker.compose.project': 'x' })).toBeNull();
    expect(parseTraefikLabels(undefined)).toBeNull();
    expect(parseTraefikLabels({})).toBeNull();
  });

  it('reports disabled when traefik.enable=false', () => {
    const info = parseTraefikLabels({
      'traefik.enable': 'false',
      'traefik.http.routers.x.rule': 'Host(`a.io`)',
    })!;
    expect(info.enabled).toBe(false);
    expect(info.routers).toHaveLength(1);
  });
});

describe('hostsFromRule', () => {
  it('extracts hosts from Host() and HostSNI()', () => {
    expect(hostsFromRule('Host(`a.io`, `b.io`)')).toEqual(['a.io', 'b.io']);
    expect(hostsFromRule('HostSNI(`m.io`)')).toEqual(['m.io']);
    expect(hostsFromRule('Host("q.io") || Path(`/x`)')).toEqual(['q.io']);
  });

  it('dedupes and ignores non-host matchers', () => {
    expect(hostsFromRule('Host(`a.io`) && Host(`a.io`)')).toEqual(['a.io']);
    expect(hostsFromRule('PathPrefix(`/v1`)')).toEqual([]);
  });
});
