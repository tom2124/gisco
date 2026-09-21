export interface ComposeEnvVar {
  name: string;
  /** Default from `${VAR:-default}` / `${VAR-default}` forms, else ''. */
  defaultValue: string;
}

export const STACK_NAME_VAR = 'STACK_NAME';

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';

/**
 * Extract `$VAR` / `${VAR}` / `${VAR:-default}` references from compose text,
 * in order of first appearance. `$$` escapes are ignored.
 */
export function extractEnvVars(compose: string): ComposeEnvVar[] {
  const seen = new Map<string, string>();

  const braced = new RegExp(`\\$\\{(${IDENT})((?::-[^}]*)|(?:-[^}]*)|(?:[^}]*))?\\}`, 'g');
  let m: RegExpExecArray | null;
  while ((m = braced.exec(compose)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    const suffix = m[2] ?? '';
    let def = '';
    // Only :- and - carry a usable default value (:? :+ ? + are operators).
    const dm = suffix.match(/^(?::-|-)([\s\S]*)$/);
    if (dm) def = dm[1];
    seen.set(name, def);
  }

  const simple = new RegExp('(?<!\\$)\\$(?![\\$\\{])(' + IDENT + ')', 'g');
  while ((m = simple.exec(compose)) !== null) {
    if (!seen.has(m[1])) seen.set(m[1], '');
  }

  return [...seen.entries()].map(([name, defaultValue]) => ({ name, defaultValue }));
}

/** Build a `.env` file body from ordered names + values. */
export function buildEnvContent(names: string[], values: Record<string, string>): string {
  return names.map((n) => `${n}=${values[n] ?? ''}`).join('\n');
}

/**
 * Preview helper: substitute known non-empty values (else `:-`/`-` defaults,
 * else leave the reference untouched). `$$` escapes resolve to `$`.
 */
export function interpolateCompose(
  compose: string,
  values: Record<string, string>
): string {
  const ESC = '\u0000';
  let out = compose.replace(/\$\$/g, ESC);

  out = out.replace(
    new RegExp(`\\$\\{(${IDENT})((?::-[^}]*)|(?:-[^}]*)|(?:[^}]*))?\\}`, 'g'),
    (match, name: string, suffix: string | undefined) => {
      const value = values[name];
      if (value != null && value !== '') return value;
      const dm = (suffix ?? '').match(/^(?::-|-)([\s\S]*)$/);
      if (dm) return dm[1];
      return match;
    }
  );

  out = out.replace(
    new RegExp('(?<!\\$)\\$(?![\\$\\{])(' + IDENT + ')', 'g'),
    (match, name: string) => {
      const value = values[name];
      return value != null && value !== '' ? value : match;
    }
  );

  return out.replace(new RegExp(ESC, 'g'), '$');
}
