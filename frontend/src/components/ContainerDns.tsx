import React, { useMemo } from 'react';
import { ContainerNode } from '../types';
import Copyable from './Copyable';

interface DnsEntry {
  value: string;
  context: string;
}

interface ContainerDnsProps {
  container: ContainerNode;
}

export const ContainerDns: React.FC<ContainerDnsProps> = ({ container }) => {
  const entries = useMemo<DnsEntry[]>(() => {
    const seen = new Set<string>();
    const out: DnsEntry[] = [];
    const push = (value: string | undefined | null, context: string) => {
      const v = (value || '').trim();
      if (!v || seen.has(v.toLowerCase())) return;
      seen.add(v.toLowerCase());
      out.push({ value: v, context });
    };

    push(container.name, 'container name');
    push(container.hostname, 'hostname');
    if (container.hostname && container.domainname) {
      push(`${container.hostname}.${container.domainname}`, 'fqdn');
    }
    for (const iface of container.interfaces) {
      for (const alias of iface.aliases || []) {
        push(alias, iface.network_name);
      }
    }
    return out;
  }, [container]);

  if (entries.length === 0) return null;

  return (
    <div style={{ borderTop: 'var(--border-width) solid var(--border-subtle)', paddingTop: 'var(--space-12)', marginTop: 'var(--space-4)' }}>
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          DNS Names & Aliases
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-8)' }}>
        {entries.map((entry) => (
          <Copyable
            key={`${entry.context}:${entry.value}`}
            text={entry.value}
            style={{
              background: 'var(--accent-wash-hover)',
              border: 'var(--border-width) solid var(--accent-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-8) var(--space-12)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              color: 'var(--text-info)',
            }}
          >
            {entry.value}
            <span style={{ color: 'var(--text-dim)', marginLeft: 'var(--space-8)', fontSize: '0.7rem' }}>
              {entry.context}
            </span>
          </Copyable>
        ))}
      </div>
    </div>
  );
};

export default ContainerDns;
