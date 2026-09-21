export interface ComposeEnvVar {
  name: string;
  /** Default from `${VAR:-default}` / `${VAR-default}` forms, else ''. */
  defaultValue: string;
  /** True when the variable is supplied automatically by the environment
   * (compose pre-defined or docker CLI vars) — see AUTO_ENV_VARS. */
  auto: boolean;
  /** Where the automatic value comes from ('compose' | 'docker'), if auto. */
  autoSource?: string;
}

export const STACK_NAME_VAR = 'STACK_NAME';

/**
 * Variables supplied automatically by the environment that compose/docker
 * resolve on their own. Writing them empty into a `.env` file would clobber
 * the automatic value (e.g. blank COMPOSE_PROJECT_NAME breaks project
 * attribution), so the UI leaves them out unless explicitly overridden.
 * Sources: compose pre-defined vars
 * (https://docs.docker.com/compose/how-tos/environment-variables/envvars/)
 * plus inherited docker CLI vars
 * (https://docs.docker.com/reference/cli/docker/#environment-variables).
 * There is no API to enumerate these; curate by hand when docs change.
 */
const AUTO_ENV_VARS: Record<string, string> = {
  COMPOSE_PROJECT_NAME: 'compose',
  COMPOSE_FILE: 'compose',
  COMPOSE_PROFILES: 'compose',
  COMPOSE_CONVERT_WINDOWS_PATHS: 'compose',
  COMPOSE_PATH_SEPARATOR: 'compose',
  COMPOSE_IGNORE_ORPHANS: 'compose',
  COMPOSE_REMOVE_ORPHANS: 'compose',
  COMPOSE_PARALLEL_LIMIT: 'compose',
  COMPOSE_ANSI: 'compose',
  COMPOSE_STATUS_STDOUT: 'compose',
  COMPOSE_ENV_FILES: 'compose',
  COMPOSE_DISABLE_ENV_FILE: 'compose',
  COMPOSE_MENU: 'compose',
  COMPOSE_EXPERIMENTAL: 'compose',
  COMPOSE_PROGRESS: 'compose',
  DOCKER_API_VERSION: 'docker',
  DOCKER_CERT_PATH: 'docker',
  DOCKER_CONFIG: 'docker',
  DOCKER_CONTEXT: 'docker',
  DOCKER_CUSTOM_HEADERS: 'docker',
  DOCKER_DEFAULT_PLATFORM: 'docker',
  DOCKER_HIDE_LEGACY_COMMANDS: 'docker',
  DOCKER_HOST: 'docker',
  DOCKER_TLS: 'docker',
  DOCKER_TLS_VERIFY: 'docker',
  BUILDKIT_PROGRESS: 'docker',
  NO_COLOR: 'docker',
  HTTP_PROXY: 'docker',
  HTTPS_PROXY: 'docker',
  NO_PROXY: 'docker',
  ALL_PROXY: 'docker',
  http_proxy: 'docker',
  https_proxy: 'docker',
  no_proxy: 'docker',
  all_proxy: 'docker',
};

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

  return [...seen.entries()].map(([name, defaultValue]) => ({
    name,
    defaultValue,
    auto: name in AUTO_ENV_VARS,
    autoSource: AUTO_ENV_VARS[name],
  }));
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
