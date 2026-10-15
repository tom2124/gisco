import React, { useMemo } from 'react';
import { ContainerNode } from '../types';
import { buildDnsEntries, DnsEntry } from '../utils/dnsEntries';
import Copyable from './Copyable';

interface ContainerDnsProps {
  container: ContainerNode;
}

export const ContainerDns: React.FC<ContainerDnsProps> = ({ container }) => {
  // Entry building lives in utils/dnsEntries so it can be unit tested: vitest
  // here only picks up src/**/*.test.ts, so a test against this component would
  // be silently ignored rather than failing.
  const entries = useMemo<DnsEntry[]>(() => buildDnsEntries(container), [container]);

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
