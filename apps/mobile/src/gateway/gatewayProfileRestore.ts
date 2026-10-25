import type { GatewayProfile } from './setupCode';

export type GatewayProfileRestorePlan = {
  serialized: string;
  source: 'shared' | 'private' | 'legacy';
  shouldConnect: true;
  shouldPersistPrivate: boolean;
};

export type SettledSharedGatewayProfile = {
  profile: GatewayProfile | null;
  problem: string;
};

export async function settledSharedGatewayProfile(
  load: () => Promise<GatewayProfile | null>,
): Promise<SettledSharedGatewayProfile> {
  try {
    return { profile: await load(), problem: '' };
  } catch (error) {
    return {
      profile: null,
      problem: error instanceof Error ? error.message : 'shared Keychain read failed',
    };
  }
}

/**
 * Chooses the strongest available pairing record for a cold start.
 *
 * Every accepted record is connection authority. The shared Keychain is the
 * preferred cross-surface source, but a temporarily unavailable shared item
 * must not strand a still-valid RN SecureStore pairing in an offline startup
 * placeholder state.
 */
export function gatewayProfileRestorePlan(
  shared: GatewayProfile | null,
  current: string | null,
  legacy: string | null,
): GatewayProfileRestorePlan | null {
  if (shared) {
    return {
      serialized: JSON.stringify(shared),
      source: 'shared',
      shouldConnect: true,
      shouldPersistPrivate: true,
    };
  }
  if (current) {
    return {
      serialized: current,
      source: 'private',
      shouldConnect: true,
      shouldPersistPrivate: false,
    };
  }
  if (legacy) {
    return {
      serialized: legacy,
      source: 'legacy',
      shouldConnect: true,
      shouldPersistPrivate: true,
    };
  }
  return null;
}
