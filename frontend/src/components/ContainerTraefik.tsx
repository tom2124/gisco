import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { parseTraefikLabels } from '../utils/traefik';
import { api } from '../api/client';
import Copyable from './Copyable';

interface ContainerTraefikProps {
  labels?: Record<string, string>;
  /** Routers resolved from a running Traefik instance for this container. */
  routers?: any[];
  /** Container name; used to fetch routers from Traefik when `routers` is not passed. */
  containerName?: string;
}

export const ContainerTraefik: React.FC<ContainerTraefikProps> = ({ labels, routers, containerName }) => {
  const info = useMemo(() => parseTraefikLabels(labels), [labels]);
  const [fetched, setFetched] = useState<any[] | null>(null);

  useEffect(() => {
    if (routers && routers.length > 0) return;
    if (!containerName) return;
    let cancelled = false;
    api.getTraefik().then((res) => {
      if (cancelled || !res.enabled) return;
      const matching = (res.routers || []).filter((r: any) => r.container === containerName);
      if (matching.length > 0) setFetched(matching);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [containerName, routers]);

  const apiRouters = (routers && routers.length > 0 ? routers : fetched) || null;

  if (apiRouters) {
    return (
      <div style={{ borderTop: 'var(--border-width) solid var(--border-subtle)', paddingTop: 'var(--space-12)', marginTop: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-8)' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Traefik Routing
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
          {apiRouters.map((router: any) => (
            <div key={`${router.protocol}:${router.name}`} style={{
              background: 'var(--success-wash)',
              border: 'var(--border-width) solid var(--success-wash-hover)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-8) var(--space-12)',
              fontSize: '0.78rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
                <span className="font-mono" style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                  {router.name}
                </span>
                <span className="badge" style={{ fontSize: '0.65rem' }}>{router.protocol}</span>
                {router.tls && (
                  <span className="badge badge-running" style={{ fontSize: '0.65rem' }}>TLS</span>
                )}
                {(router.entrypoints || []).map((ep: string) => (
                  <span key={ep} className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                    {ep}
                  </span>
                ))}
              </div>
              {router.hosts && router.hosts.length > 0 ? (
                <div className="font-mono" style={{ color: 'var(--text-success)', fontSize: '0.8rem', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4) var(--space-12)' }}>
                  {router.hosts.map((host: string) => (
                    <span key={host} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-8)' }}>
                      <Copyable text={host}>
                        <span>{host}</span>
                      </Copyable>
                      {router.protocol === 'http' && !host.includes('*') && (
                        <a
                          href={`${router.tls ? 'https' : 'http'}://${host}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Open ${host} in new tab`}
                          onClick={(e) => e.stopPropagation()}
                          style={{ display: 'inline-flex', color: 'var(--text-dim)' }}
                        >
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </span>
                  ))}
                </div>
              ) : router.rule ? (
                <Copyable text={router.rule}>
                  <div className="font-mono" style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                    {router.rule}
                  </div>
                </Copyable>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!info) return null;

  return (
    <div style={{ borderTop: 'var(--border-width) solid var(--border-subtle)', paddingTop: 'var(--space-12)', marginTop: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-8)' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Traefik Routing
        </span>
        {!info.enabled && (
          <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
            disabled via label
          </span>
        )}
      </div>

      {!info.enabled ? (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
          Traefik is disabled for this container (`traefik.enable=false`).
        </div>
      ) : info.routers.length === 0 ? (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
          Traefik labels present but no routers defined.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
          {info.routers.map((router) => {
            const servicePort = info.services.find((s) => s.name === router.service)?.port;
            return (
              <div key={`${router.protocol}:${router.name}`} style={{
                background: 'var(--success-wash)',
                border: 'var(--border-width) solid var(--success-wash-hover)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-8) var(--space-12)',
                fontSize: '0.78rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
                  <span className="font-mono" style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                    {router.name}
                  </span>
                  <span className="badge" style={{ fontSize: '0.65rem' }}>{router.protocol}</span>
                  {router.tls && (
                    <span className="badge badge-running" style={{ fontSize: '0.65rem' }}>TLS</span>
                  )}
                  {router.entrypoints.map((ep) => (
                    <span key={ep} className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                      {ep}
                    </span>
                  ))}
                </div>
                {router.hosts.length > 0 ? (
                  <div className="font-mono" style={{ color: 'var(--text-success)', fontSize: '0.8rem', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4) var(--space-12)' }}>
                    {router.hosts.map((host) => (
                      <span key={host} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-8)' }}>
                        <Copyable text={host}>
                          <span>{host}</span>
                        </Copyable>
                        {router.protocol === 'http' && !host.includes('*') && (
                          <a
                            href={`${router.tls ? 'https' : 'http'}://${host}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Open ${host} in new tab`}
                            onClick={(e) => e.stopPropagation()}
                            style={{ display: 'inline-flex', color: 'var(--text-dim)' }}
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </span>
                    ))}
                  </div>
                ) : router.rule ? (
                  <Copyable text={router.rule}>
                    <div className="font-mono" style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                      {router.rule}
                    </div>
                  </Copyable>
                ) : null}
                {(router.service || router.middlewares.length > 0) && (
                  <div style={{ marginTop: 'var(--space-4)', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                    {router.service && (
                      <span className="font-mono">
                        → {router.service}{servicePort ? `:${servicePort}` : ''}
                      </span>
                    )}
                    {router.middlewares.length > 0 && (
                      <span style={{ marginLeft: router.service ? '8px' : 0 }}>
                        via {router.middlewares.join(', ')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ContainerTraefik;
