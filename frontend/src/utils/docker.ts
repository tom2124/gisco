export interface ParsedImageReference {
  image: string;
  tag?: string;
}

/** Split a user-entered image reference without confusing registry ports for tags. */
export function parseImageReference(reference: string): ParsedImageReference {
  const value = reference.trim();
  const digestSeparator = value.indexOf('@');
  if (digestSeparator > 0) {
    return {
      image: value.slice(0, digestSeparator),
      tag: value.slice(digestSeparator + 1),
    };
  }

  const lastColon = value.lastIndexOf(':');
  const lastSlash = value.lastIndexOf('/');
  if (lastColon > lastSlash && lastColon > 0) {
    return {
      image: value.slice(0, lastColon),
      tag: value.slice(lastColon + 1),
    };
  }

  return { image: value };
}

/** Human-readable IEC byte size. Unknown/negative values render as an em dash. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
  const unitIndex = Math.max(
    0,
    Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  );
  const value = bytes / Math.pow(1024, unitIndex);
  return `${Number.parseFloat(value.toFixed(1))} ${units[unitIndex]}`;
}
