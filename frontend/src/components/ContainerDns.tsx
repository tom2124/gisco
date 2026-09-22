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
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px', marginTop: '4px' }}>
      <div style={{ marginBottom: '8px' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          DNS Names & Aliases
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {entries.map((entry) => (
          <Copyable
            key={`${entry.context}:${entry.value}`}
            text={entry.value}
            style={{
              background: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 10px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              color: '#7dd3fc',
            }}
          >
            {entry.value}
            <span style={{ color: 'var(--text-dim)', marginLeft: '8px', fontSize: '0.7rem' }}>
              {entry.context}
            </span>
          </Copyable>
        ))}
      </div>
    </div>
  );
};

export default ContainerDns;
