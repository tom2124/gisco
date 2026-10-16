import { describe, expect, it } from 'vitest';
import { buildDnsEntries, DnsEntry, DnsSource } from './dnsEntries';

const container = (over: Partial<DnsSource> = {}): DnsSource => ({
  name: 'app-1',
  hostname: 'app-1',
  interfaces: [],
  ...over,
});

describe('buildDnsEntries', () => {
  it('lists the container identity entries first, merged onto one chip', () => {
    const entries = buildDnsEntries(
      container({ hostname: 'app-1', domainname: 'example' })
    );
    expect(entries).toEqual([
      // Same name as both the container name and the hostname, so one chip.
      { value: 'app-1', contexts: ['container name', 'hostname'] },
      { value: 'app-1.example', contexts: ['fqdn'] },
    ]);
  });

  it('omits the fqdn unless both hostname and domainname are present', () => {
    expect(buildDnsEntries(container({ hostname: undefined })))
      .toEqual([{ value: 'app-1', contexts: ['container name'] }]);
    expect(buildDnsEntries(container({ hostname: 'app-1', domainname: '' }))).toEqual([
      { value: 'app-1', contexts: ['container name', 'hostname'] },
    ]);
  });

  it('merges one alias shared by two networks into a single chip', () => {
    // The reported case: `db` on two networks produced two identical chips, and
    // the pre-fix dedupe produced one chip naming an arbitrary network.
    const entries = buildDnsEntries(
      container({
        interfaces: [
          { network_name: 'app_default', aliases: ['db'] },
          { network_name: 'shared', aliases: ['db'] },
        ],
      })
    );
    expect(entries).toEqual([
      { value: 'app-1', contexts: ['container name', 'hostname'] },
      { value: 'db', contexts: ['app_default', 'shared'] },
    ]);
  });

  it('keeps the full network set whatever order the interfaces arrive in', () => {
    const ifaces = [
      { network_name: 'app_default', aliases: ['db', 'cache'] },
      { network_name: 'shared', aliases: ['db'] },
      { network_name: 'metrics', aliases: ['db', 'cache'] },
    ];
    const forward = buildDnsEntries(container({ interfaces: ifaces }));
    const reversed = buildDnsEntries(container({ interfaces: [...ifaces].reverse() }));

    const byName = (e: DnsEntry) => e.value;
    const setOf = (es: DnsEntry[]) =>
      Object.fromEntries(
        es.map((e: DnsEntry) => [e.value, [...e.contexts].sort()])
      );

    // Membership must be identical; only the leading order may differ.
    expect(setOf(reversed)).toEqual(setOf(forward));
    expect(forward.filter((e) => e.value === 'db')).toHaveLength(1);
    expect(byName(forward.find((e) => e.value === 'db')!)).toBe('db');
    expect([...forward.find((e) => e.value === 'db')!.contexts].sort())
      .toEqual(['app_default', 'metrics', 'shared']);
  });

  it('does not repeat a context when the same alias repeats within one network', () => {
    const entries = buildDnsEntries(
      container({
        interfaces: [{ network_name: 'app_default', aliases: ['db', 'DB', 'db'] }],
      })
    );
    expect(entries.find((e) => e.value === 'db')).toEqual({
      value: 'db',
      contexts: ['app_default'],
    });
  });

  it('groups names case-insensitively but shows the first spelling', () => {
    const entries = buildDnsEntries(
      container({
        interfaces: [
          { network_name: 'app_default', aliases: ['DB'] },
          { network_name: 'shared', aliases: ['db'] },
        ],
      })
    );
    expect(entries.find((e) => e.contexts.includes('shared'))).toEqual({
      value: 'DB',
      contexts: ['app_default', 'shared'],
    });
  });

  it('folds an alias that matches the hostname into the same chip', () => {
    const entries = buildDnsEntries(
      container({
        interfaces: [
          { network_name: 'app_default', aliases: ['app-1'] },
          { network_name: 'shared', aliases: ['app-1'] },
        ],
      })
    );
    expect(entries).toEqual([
      { value: 'app-1', contexts: ['container name', 'hostname', 'app_default', 'shared'] },
    ]);
  });

  it('skips blank aliases and trims whitespace', () => {
    const entries = buildDnsEntries(
      container({
        interfaces: [{ network_name: 'app_default', aliases: ['', '   ', '  db  '] }],
      })
    );
    expect(entries.find((e) => e.value === 'db')).toEqual({
      value: 'db',
      contexts: ['app_default'],
    });
  });

  it('handles interfaces with no aliases array', () => {
    const entries = buildDnsEntries({
      name: 'app-1',
      interfaces: [{ network_name: 'app_default' } as never],
    });
    expect(entries).toEqual([{ value: 'app-1', contexts: ['container name'] }]);
  });
});