import { describe, expect, it } from 'vitest';
import { buildEnvContent, extractEnvVars, interpolateCompose } from './composeEnv';

describe('extractEnvVars', () => {
  it('extracts braced, defaulted and bare references in order', () => {
    expect(
      extractEnvVars('image: ${IMG}\nports: ["${PORT:-8080}:80"]\ncmd: $CMD\n')
    ).toEqual([
      { name: 'IMG', defaultValue: '', auto: false, autoSource: undefined },
      { name: 'PORT', defaultValue: '8080', auto: false, autoSource: undefined },
      { name: 'CMD', defaultValue: '', auto: false, autoSource: undefined },
    ]);
  });

  it('flags auto-supplied compose/docker variables', () => {
    const vars = extractEnvVars('name: ${COMPOSE_PROJECT_NAME}\nhost: $DOCKER_HOST\n');
    expect(vars).toEqual([
      { name: 'COMPOSE_PROJECT_NAME', defaultValue: '', auto: true, autoSource: 'compose' },
      { name: 'DOCKER_HOST', defaultValue: '', auto: true, autoSource: 'docker' },
    ]);
  });

  it('ignores $$ escapes and :? operators, keeps - defaults', () => {
    expect(extractEnvVars('a=$$ESCAPED b=${MISSING:?err} c=${EMPTY-}')).toEqual([
      { name: 'MISSING', defaultValue: '', auto: false, autoSource: undefined },
      { name: 'EMPTY', defaultValue: '', auto: false, autoSource: undefined },
    ]);
  });

  it('dedupes repeat references', () => {
    expect(extractEnvVars('${A} ${A} $A')).toEqual([
      { name: 'A', defaultValue: '', auto: false, autoSource: undefined },
    ]);
  });
});

describe('buildEnvContent', () => {
  it('joins ordered KEY=value lines', () => {
    expect(buildEnvContent(['STACK_NAME', 'PORT'], { STACK_NAME: 'demo', PORT: '9090' })).toBe(
      'STACK_NAME=demo\nPORT=9090'
    );
    expect(buildEnvContent(['MISSING'], {})).toBe('MISSING=');
  });
});

describe('interpolateCompose', () => {
  it('prefers values, then :- defaults, else leaves references', () => {
    expect(
      interpolateCompose('a=${IMG} b=${PORT:-8080} c=$CMD d=$$X e=${MISSING:?err} f=${EMPTY-}', {
        IMG: 'nginx',
        PORT: '',
        CMD: 'run',
      })
    ).toBe('a=nginx b=8080 c=run d=$X e=${MISSING:?err} f=');
  });
});
