import { describe, expect, it } from 'vitest';
import { buildDnsEntries, DnsSource } from './dnsEntries';

const container = (over: Partial<DnsSource> = {}): DnsSource => ({
  name: 'app-1',
  hostname: 'app-1',
  interfaces: [],
  ...over,
});

describe('buildDnsEntries', () => {
  it('lists the container identity entries first', () => {
    const entries = buildDnsEntries(
      container({ hostname: 'app-1', domainname: 'example' })
    );
    expect(entries).toEqual([
      { value: 'app-1', context: 'container name' },
      { value: 'app-1', context: 'hostname' },
      { value: 'app-1.example', context: 'fqdn' },
    ]);
  });

  it('omits the fqdn unless both hostname and domainname are present', () => {
    expect(buildDnsEntries(container({ hostname: undefined })).map((e) => e.value))
      .toEqual(['app-1']);
    expect(buildDnsEntries(container({ hostname: 'app-1', domainname: '' })).map((e) => e.value))
      .toEqual(['app-1', 'app-1']);
  });

  it('attributes an alias to every network that actually carries it', () => {
    // The bug: the same alias on two networks was emitted once, labelled with
    // whichever interface came first, so it looked attached to the wrong
    // network depending on iteration order.
    const entries = buildDnsEntries(
      container({
        interfaces: [
          { network_name: 'app_default', aliases: ['db'] },
          { network_name: 'shared', aliases: ['db'] },
        ],
      })
    );
    expect(entries.filter((e) => e.value === 'db')).toEqual([
      { value: 'db', context: 'app_default' },
      { value: 'db', context: 'shared' },
    ]);
  });

  it('gives the same alias every network regardless of interface order', () => {
    const ifaces = [
      { network_name: 'app_default', aliases: ['db', 'cache'] },
      { network_name: 'shared', aliases: ['db'] },
    ];
    const forward = buildDnsEntries(container({ interfaces: ifaces }));
    const reversed = buildDnsEntries(container({ interfaces: [...ifaces].reverse() }));

    // As sets of context/value pairs the answers must be identical — the UI may
    // reorder, but it must never invent or drop a network association.
    const key = (e: { value: string; context: string }) => `${e.context}:${e.value}`;
    expect([...forward.map(key)].sort()).toEqual([...reversed.map(key)].sort());
    expect(forward.filter((e) => e.value === 'db')).toHaveLength(2);
  });

  it('still collapses a duplicate alias repeated within one network', () => {
    const entries = buildDnsEntries(
      container({ interfaces: [{ network_name: 'app_default', aliases: ['db', 'DB'] }] })
    );
    expect(entries.filter((e) => e.context === 'app_default')).toEqual([
      { value: 'db', context: 'app_default' },
    ]);
  });

  it('skips blank aliases and trims whitespace', () => {
    const entries = buildDnsEntries(
      container({
        interfaces: [{ network_name: 'app_default', aliases: ['', '   ', '  db  '] }],
      })
    );
    expect(entries.filter((e) => e.context === 'app_default'))
      .toEqual([{ value: 'db', context: 'app_default' }]);
  });

  it('handles interfaces with no aliases array', () => {
    const entries = buildDnsEntries({
      name: 'app-1',
      interfaces: [{ network_name: 'app_default' } as never],
    });
    expect(entries).toEqual([{ value: 'app-1', context: 'container name' }]);
  });

  it('shows an alias that collides with the hostname once per network', () => {
    // The hostname and a network alias can legitimately be the same string;
    // each is a real answer and should be labelled as such.
    const entries = buildDnsEntries(
      container({
        interfaces: [{ network_name: 'app_default', aliases: ['app-1'] }],
      })
    );
    expect(entries).toEqual([
      { value: 'app-1', context: 'container name' },
      { value: 'app-1', context: 'hostname' },
      { value: 'app-1', context: 'app_default' },
    ]);
  });
});