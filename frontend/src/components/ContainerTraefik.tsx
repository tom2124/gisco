import React, { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { parseTraefikLabels } from '../utils/traefik';
import Copyable from './Copyable';

interface ContainerTraefikProps {
  labels?: Record<string, string>;
}

export const ContainerTraefik: React.FC<ContainerTraefikProps> = ({ labels }) => {
  const info = useMemo(() => parseTraefikLabels(labels), [labels]);

  if (!info) return null;

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px', marginTop: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Traefik Routing
        </span>
        {!info.enabled && (
          <span className="badge badge-stopped" style={{ fontSize: '0.7rem' }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {info.routers.map((router) => {
            const servicePort = info.services.find((s) => s.name === router.service)?.port;
            return (
              <div key={`${router.protocol}:${router.name}`} style={{
                background: 'rgba(16, 185, 129, 0.07)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 12px',
                fontSize: '0.78rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  <span className="font-mono" style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                    {router.name}
                  </span>
                  <span className="badge" style={{ fontSize: '0.65rem' }}>{router.protocol}</span>
                  {router.tls && (
                    <span className="badge badge-running" style={{ fontSize: '0.65rem' }}>TLS</span>
                  )}
                  {router.entrypoints.map((ep) => (
                    <Copyable key={ep} text={ep}>
                      <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                        {ep}
                      </span>
                    </Copyable>
                  ))}
                </div>
                {router.hosts.length > 0 ? (
                  <div className="font-mono" style={{ color: '#a7f3d0', fontSize: '0.8rem', display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
                    {router.hosts.map((host) => (
                      <span key={host} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
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
                  <div style={{ marginTop: '4px', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
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
