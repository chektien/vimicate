import type { GatewayProfile } from './setupCode';

export type GatewayDeviceFamily = 'ipad' | 'iphone';

/**
 * Native Vimicate historically registers every paired identity as `ipad`,
 * including the approved identity created on an iPhone. Reusing that native
 * identity requires preserving its signed registration metadata; changing
 * only `deviceFamily` makes OpenClaw treat the same key as a changed device.
 * This affects authentication metadata only. React Native layout continues to
 * use the real device type, so the compact iPhone workspace is unchanged.
 */
export function gatewayDeviceFamilyForProfile(profile: GatewayProfile, physicalFamily: GatewayDeviceFamily): GatewayDeviceFamily {
  return profile.authoritySource === 'sharedKeychain' ? 'ipad' : physicalFamily;
}
