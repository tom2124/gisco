interface ParsedIp {
  /** 0 = IPv4, 1 = other non-empty text, 2 = empty/missing (sorts last). */
  rank: number;
  parts: number[];
  raw: string;
}

function parseIp(ip: string | undefined | null): ParsedIp {
  if (!ip) return { rank: 2, parts: [], raw: '' };
  const segs = ip.split('.');
  if (
    segs.length === 4 &&
    segs.every((s) => /^\d{1,3}$/.test(s) && Number(s) <= 255)
  ) {
    return { rank: 0, parts: segs.map(Number), raw: ip };
  }
  return { rank: 1, parts: [], raw: ip };
}

/** Stable ascending sort for IP addresses (numeric octets, not lexical). */
export function compareIps(
  a: string | undefined | null,
  b: string | undefined | null
): number {
  const pa = parseIp(a);
  const pb = parseIp(b);
  if (pa.rank !== pb.rank) return pa.rank - pb.rank;
  for (let i = 0; i < Math.max(pa.parts.length, pb.parts.length); i++) {
    const diff = (pa.parts[i] ?? 0) - (pb.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return pa.raw.localeCompare(pb.raw);
}
