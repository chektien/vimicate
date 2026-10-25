import { createContext } from 'react';
import type { GatewayArtifactResolver } from './gatewayArtifactDownload';

/** The mounted workspace owns paired RPC access; attachment facts stay serializable. */
export const GatewayArtifactContext = createContext<GatewayArtifactResolver | undefined>(undefined);
