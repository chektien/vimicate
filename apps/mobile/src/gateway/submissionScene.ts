import { gatewayRequestWasRefused } from './gatewayRequestDelivery';

/** Preserve definite non-delivery across scene suspension. Uncertain results
 * remain owned by reconciliation, never by an automatic resend. */
export function submissionScene(ownsScene: () => boolean) {
  const sceneRetired = {};
  const awaitOwned = async <T,>(operation: Promise<T>) => {
    try {
      const result = await operation;
      if (!ownsScene()) throw sceneRetired;
      return result;
    } catch (error) {
      if (gatewayRequestWasRefused(error)) throw error;
      if (!ownsScene()) throw sceneRetired;
      throw error;
    }
  };
  return { sceneRetired, awaitOwned };
}
