const ANSI_CSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * Append raw stream output to a line buffer using terminal-like semantics.
 *
 * Chunks without a trailing newline extend the current line, `\n` completes it,
 * and `\r` overwrites the current line. Docker's progress output (image pulls,
 * layer downloads) redraws a single line with `\r`, so without this every update
 * would appear as a new line. CSI escape sequences are stripped for display.
 */
export function appendTerminalOutput(lines: readonly string[], chunk: string): string[] {
  const text = chunk.replace(ANSI_CSI, '').replace(/\r\n/g, '\n');
  if (!text) return [...lines];

  const out = lines.length > 0 ? [...lines] : [''];
  const segments = text.split('\n');

  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    const carriageReturn = segment.lastIndexOf('\r');

    if (carriageReturn >= 0) {
      // Everything after the final \r is the redrawn line content.
      out[out.length - 1] = segment.slice(carriageReturn + 1);
      if (!isLast) out.push('');
      return;
    }

    out[out.length - 1] += segment;
    if (!isLast) out.push('');
  });

  return out;
}
