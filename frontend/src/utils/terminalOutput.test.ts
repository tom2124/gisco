import { describe, expect, it } from 'vitest';
import { appendTerminalOutput } from './terminalOutput';

describe('appendTerminalOutput', () => {
  it('joins partial chunks into one line', () => {
    const first = appendTerminalOutput([], 'Down');
    const second = appendTerminalOutput(first, 'loading 10MB');
    expect(second).toEqual(['Downloading 10MB']);
  });

  it('completes lines on newlines', () => {
    expect(appendTerminalOutput([], 'first\nsecond\n')).toEqual(['first', 'second', '']);
  });

  it('overwrites the current line on carriage returns', () => {
    const first = appendTerminalOutput([], 'pulling: 100MB');
    const second = appendTerminalOutput(first, '\rpulling: 101MB');
    expect(second).toEqual(['pulling: 101MB']);
  });

  it('overwrites and then completes a line', () => {
    const first = appendTerminalOutput([], 'old');
    const second = appendTerminalOutput(first, '\rnew\nnext');
    expect(second).toEqual(['new', 'next']);
  });

  it('strips CSI escape sequences', () => {
    expect(appendTerminalOutput([], '\u001B[2Kprogress 50%')).toEqual(['progress 50%']);
  });

  // A real progress stream writes "text\r" repeatedly: the CR returns the
  // cursor to column 0, and the next write overwrites in place. Text already on
  // the line stays visible until it is itself overwritten.
  it('keeps text written before a trailing carriage return', () => {
    const a = appendTerminalOutput([], 'abc\r');
    expect(a).toEqual(['abc']);
    // 'de' overwrites columns 0-1; the trailing 'c' is still there.
    const b = appendTerminalOutput(a, 'de\r');
    expect(b).toEqual(['dec']);
    // The cursor stayed at column 0 after the CR, so this overwrites too.
    expect(appendTerminalOutput(b, 'f')).toEqual(['fec']);
  });

  it('overwrites in place across consecutive progress updates', () => {
    let lines: string[] = [];
    for (const size of ['100mb', '101mb', '102mb']) {
      lines = appendTerminalOutput(lines, `${size}\r`);
    }
    expect(lines).toEqual(['102mb']);
  });
});

describe('compose progress output', () => {
  // Captured verbatim from `docker compose pull` (Compose 5.5.1, no TTY). All
  // progress goes to stderr and every line is newline-terminated: there are no
  // carriage returns and no progress bar in plain mode.
  const realLines = [
    ' Image busybox:latest Pulling ',
    ' 37bb94b0940b Pulling fs layer 0B',
    ' 37bb94b0940b Downloading 32.17kB',
    ' 37bb94b0940b Downloading 2.064MB',
    ' 37bb94b0940b Download complete 0B',
    ' 37bb94b0940b Extracting 32.77kB',
    ' 37bb94b0940b Extracting 2.226MB',
    ' 37bb94b0940b Extracting 2.226MB',
    ' 37bb94b0940b Pull complete 0B',
    ' Image busybox:latest Pulled ',
  ];

  const stream = (lines: string[]): string[] =>
    lines.reduce<string[]>((acc, line) => appendTerminalOutput(acc, `${line}\n`), []);

  it('keeps one row per layer instead of one row per update', () => {
    expect(stream(realLines)).toEqual([
      ' Image busybox:latest Pulling ',
      ' 37bb94b0940b Pull complete 0B',
      ' Image busybox:latest Pulled ',
      '',
    ]);
  });

  it('arrives one websocket message at a time without regressing', () => {
    let lines: string[] = [];
    for (const line of realLines) lines = appendTerminalOutput(lines, `${line}\n`);
    expect(lines).toEqual(stream(realLines));
  });

  it('gives each interleaved layer its own row', () => {
    const interleaved = [
      ' aaaaaaaaaaaa Downloading 1MB',
      ' bbbbbbbbbbbb Downloading 1MB',
      ' aaaaaaaaaaaa Downloading 2MB',
      ' bbbbbbbbbbbb Downloading 3MB',
      ' aaaaaaaaaaaa Pull complete',
    ];
    expect(stream(interleaved)).toEqual([
      ' aaaaaaaaaaaa Pull complete',
      ' bbbbbbbbbbbb Downloading 3MB',
      '',
    ]);
  });

  it('does not treat ordinary output as progress', () => {
    const plain = ['Network myapp_default  Creating', 'Container myapp-web-1  Started'];
    expect(stream(plain)).toEqual([...plain, '']);
  });

  it('leaves a trailing partial line open for the next chunk', () => {
    const first = appendTerminalOutput([], ' 37bb94b0940b Downloa');
    expect(first).toEqual([' 37bb94b0940b Downloa']);
    expect(appendTerminalOutput(first, 'ding 2MB\n')).toEqual([' 37bb94b0940b Downloading 2MB', '']);
  });
});
