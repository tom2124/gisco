import React from 'react';
import { ContainerNode, HostPortNode } from '../types';
import ContainerHeader from './ContainerHeader';
import ContainerInterfaces from './ContainerInterfaces';
import ContainerDns from './ContainerDns';
import ContainerHostPorts from './ContainerHostPorts';
import ContainerTraefik from './ContainerTraefik';

interface ContainerCardProps {
  container: ContainerNode;
  containerHostPorts: HostPortNode[];
  onNavigateToContainers?: () => void;
  onSelectStack?: (stackName: string) => void;
}

export const ContainerCard: React.FC<ContainerCardProps> = ({
  container,
  containerHostPorts,
  onNavigateToContainers,
  onSelectStack,
}) => (
  <div className="card" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
    <ContainerHeader container={container} onNavigateToContainers={onNavigateToContainers} onSelectStack={onSelectStack} />
    <ContainerInterfaces container={container} />
    <ContainerDns container={container} />
    <ContainerHostPorts containerHostPorts={containerHostPorts} />
    <ContainerTraefik labels={container.labels} />
  </div>
);

export default ContainerCard;