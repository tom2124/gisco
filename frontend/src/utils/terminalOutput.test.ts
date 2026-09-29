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
});
