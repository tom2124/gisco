import React from 'react';
import { ContainerNode, HostPortNode } from '../types';
import ContainerHeader from './ContainerHeader';
import ContainerInterfaces from './ContainerInterfaces';
import ContainerDns from './ContainerDns';
import ContainerHostPorts from './ContainerHostPorts';
import ContainerTraefik from './ContainerTraefik';
import ContainerDetails from './ContainerDetails';

interface ContainerCardProps {
  container: ContainerNode;
  containerHostPorts: HostPortNode[];
  onNavigateToContainers?: () => void;
}

export const ContainerCard: React.FC<ContainerCardProps> = ({
  container,
  containerHostPorts,
  onNavigateToContainers,
}) => (
  <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
    <ContainerHeader container={container} onNavigateToContainers={onNavigateToContainers} />
    <ContainerInterfaces container={container} />
    <ContainerDns container={container} />
    <ContainerHostPorts containerHostPorts={containerHostPorts} />
    <ContainerTraefik labels={container.labels} />
    <ContainerDetails container={container} />
  </div>
);

export default ContainerCard;