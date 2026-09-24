const DOCKER_BUILT_IN_NETWORKS = new Set(['bridge', 'host', 'none']);

/**
 * Docker's default networks are host plumbing rather than user-managed
 * networks, so they are intentionally hidden from the Networks page.
 */
export function isBuiltInNetwork(name: string): boolean {
  return DOCKER_BUILT_IN_NETWORKS.has(name.trim().toLowerCase());
}

export function filterUserNetworks<T extends { name: string }>(networks: T[]): T[] {
  return networks.filter((network) => !isBuiltInNetwork(network.name));
}
