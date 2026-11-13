import type { ReactNode } from 'react';
import { GatewayArtifactContext, GatewayProjectImageContext } from './GatewayArtifactContext';
import type { GatewayArtifactResolver } from './gatewayArtifactDownload';
import type { GatewayProjectImageResolver } from './gatewayProjectImage';

export function GatewayMediaProvider({ value, children }: { value: { resolveArtifact: GatewayArtifactResolver; resolveProjectImage: GatewayProjectImageResolver }; children: ReactNode }) {
  return <GatewayArtifactContext value={value.resolveArtifact}><GatewayProjectImageContext value={value.resolveProjectImage}>{children}</GatewayProjectImageContext></GatewayArtifactContext>;
}
