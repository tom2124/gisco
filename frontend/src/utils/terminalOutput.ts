const ANSI_CSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * A per-layer progress line from Compose, e.g. ` 37bb94b0940b Downloading 2.064MB`.
 * The leading token is the truncated layer id, which is what identifies the
 * row being updated. Anchored at the start and restricted to exactly 12 hex
 * digits so ordinary log lines are never mistaken for progress.
 */
const PROGRESS_LAYER = /^\s*([0-9a-f]{12})\s+\S/;

function layerOf(line: string): string | null {
  const match = PROGRESS_LAYER.exec(line);
  return match ? match[1] : null;
}

interface BufferState {
  /** Cursor column within the current row; a CR sends it back to 0. */
  cursor: number;
  /** Layer id -> row index, so a layer's updates land on its own row. */
  layers: Map<string, number>;
}

/**
 * Per-buffer render state.
 *
 * Two things cannot be derived from the line array alone: the cursor column,
 * because a carriage return homes it without erasing the text; and where each
 * layer's row ended up, because progress for several layers interleaves. Callers
 * feed the previous result back in (`prev => appendTerminalOutput(prev, chunk)`),
 * so keying on the buffer's identity carries the state without changing the
 * signature. WeakMap, so buffers can still be collected.
 */
const states = new WeakMap<readonly string[], BufferState>();

/**
 * Append raw stream output to a line buffer using terminal-like semantics.
 *
 * - `\n` completes a row, `\r` returns the cursor to column 0 so following text
 *   overwrites in place, and CSI escapes are stripped.
 * - Progress lines are the exception: Compose emits one line per update
 *   (`Downloading 32kB`, then `Downloading 2MB`, ...) because it has no TTY to
 *   redraw a single line on. Each layer keeps one row that is overwritten as it
 *   progresses, so it reads like a terminal instead of scrolling forever.
 */
export function appendTerminalOutput(lines: readonly string[], chunk: string): string[] {
  const text = chunk.replace(ANSI_CSI, '').replace(/\r\n/g, '\n');
  if (!text) return [...lines];

  const out = lines.length > 0 ? [...lines] : [''];
  const previous = states.get(lines);
  const layers = new Map(previous?.layers);

  let buf = [...out[out.length - 1]];
  let cursor = previous?.cursor ?? buf.length;

  const segments = text.split('\n');
  const lastIndex = segments.length - 1;

  segments.forEach((segment, index) => {
    for (const ch of segment) {
      if (ch === '\r') {
        cursor = 0;
        continue;
      }
      if (cursor < buf.length) buf[cursor] = ch;
      else buf.push(ch);
      cursor++;
    }
    if (index === lastIndex) return;

    // The row is finished. Progress lines update their layer's row in place;
    // everything else occupies a new row.
    const content = buf.join('');
    const layer = layerOf(content);
    const at = layer !== null ? layers.get(layer) : undefined;
    if (at !== undefined && at < out.length - 1) {
      out[at] = content;
      out[out.length - 1] = '';
    } else {
      out[out.length - 1] = content;
      if (layer !== null) layers.set(layer, out.length - 1);
      out.push('');
    }
    buf = [];
    cursor = 0;
  });

  out[out.length - 1] = buf.join('');
  states.set(out, { cursor, layers });
  return out;
}