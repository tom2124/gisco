export type StackStatus = 'Running' | 'Partial' | 'Stopped' | 'Empty';

export interface StackSummary {
  name: string;
  path: string;
  compose_file: string;
  status: StackStatus;
  total_services: number;
  running_services: number;
  has_env: boolean;
  updated_at: string;
  external: boolean;
  description?: string;
}

export interface StackContainerInfo {
  id: string;
  name: string;
  service?: string;
  state: string;
  status: string;
  image: string;
  ports: string[];
  interfaces: Array<{
    network_id: string;
    network_name: string;
    ip_address: string;
    mac_address: string;
    gateway: string;
    aliases: string[];
  }>;
  hostname?: string;
  domainname?: string;
  labels?: Record<string, string>;
  host_ports?: HostPortNode[];
}

export interface StackDetails {
  name: string;
  path: string;
  compose_file: string;
  compose_content: string;
  env_content?: string;
  status: StackStatus;
  services: string[];
  containers: StackContainerInfo[];
  file_uid: number;
  file_gid: number;
  file_mode: number;
  external: boolean;
  description?: string;
}

export interface TemplateSummary {
  id: string;
  name: string;
  filename: string;
  description?: string;
}

export interface TemplateDetails extends TemplateSummary {
  raw_content: string;
}

export interface ContainerSummary {
  Id: string;
  Names: string[];
  Image: string;
  ImageID: string;
  Command: string;
  Created: number;
  State: string;
  Status: string;
  Ports: Array<{
    IP?: string;
    PrivatePort: number;
    PublicPort?: number;
    Type?: string;
  }>;
  Labels?: Record<string, string>;
}

export interface ContainerMetrics {
  container_id: string;
  cpu_percent: number;
  memory_usage_bytes: number;
  memory_limit_bytes: number;
  memory_percent: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
  block_read_bytes: number;
  block_write_bytes: number;
  timestamp: string;
}

export interface NetworkNode {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  subnet?: string;
  gateway?: string;
  container_count: number;
}

export interface ContainerInterface {
  network_id: string;
  network_name: string;
  ip_address: string;
  mac_address: string;
  gateway: string;
  aliases: string[];
}

export interface ContainerPortMapping {
  container_port: number;
  protocol: string;
  host_ip?: string;
  host_port?: number;
}

export interface ContainerNode {
  id: string;
  name: string;
  image: string;
  state: string;
  stack?: string;
  interfaces: ContainerInterface[];
  ports: ContainerPortMapping[];
  hostname?: string;
  domainname?: string;
  labels?: Record<string, string>;
}

export interface HostPortNode {
  id: string;
  host_ip: string;
  host_port: number;
  protocol: string;
  target_container_id: string;
  target_container_port: number;
}

export interface NetworkLink {
  source: string;
  target: string;
  link_type: 'interface' | 'port_forward';
  label: string;
  ip?: string;
  mac?: string;
  port?: string;
}

export interface NetworkGraph {
  networks: NetworkNode[];
  containers: ContainerNode[];
  host_ports: HostPortNode[];
  links: NetworkLink[];
}

export interface ImageSummary {
  Id: string;
  ParentId: string;
  RepoTags?: string[];
  RepoDigests?: string[];
  Created: number;
  Size: number;
  VirtualSize: number;
  SharedSize: number;
  Labels?: Record<string, string>;
  Containers: number;
}

export interface DockerNetwork {
  Id?: string;
  Name?: string;
  Driver?: string;
  Scope?: string;
  Internal?: boolean;
  IPAM?: {
    Config?: Array<{
      Subnet?: string;
      Gateway?: string;
    }>;
  };
  Containers?: Record<string, {
    Name?: string;
    EndpointID?: string;
    MacAddress?: string;
    IPv4Address?: string;
  }>;
}

export interface VolumeUsageData {
  Size: number;
  RefCount: number;
}

export interface DockerVolume {
  Name: string;
  Driver: string;
  Mountpoint: string;
  CreatedAt?: string;
  Labels?: Record<string, string>;
  Scope: string;
  UsageData?: VolumeUsageData;
}

export interface SystemStatus {
  docker_connected: boolean;
  docker_version?: string;
  docker_api_version?: string;
  os?: string;
  arch?: string;
  containers_total?: number;
  containers_running?: number;
  containers_paused?: number;
  containers_stopped?: number;
  images_count?: number;
  stack_dir: string;
  template_dir: string;
  default_uid: number;
  default_gid: number;
}
