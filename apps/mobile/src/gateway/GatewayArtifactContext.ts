import { createContext } from 'react';
import type { GatewayArtifactResolver } from './gatewayArtifactDownload';
import type { GatewayProjectImageResolver } from './gatewayProjectImage';

/** The mounted workspace owns paired RPC access; attachment facts stay serializable. */
export const GatewayArtifactContext = createContext<GatewayArtifactResolver | undefined>(undefined);
export const GatewayProjectImageContext = createContext<GatewayProjectImageResolver | undefined>(undefined);
