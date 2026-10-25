import { useGatewayWorkspace } from '../gateway/useGatewayWorkspace';
import type { AppShellFixtureProps } from './appShellFixtures';

/** Local UI fixtures must not import a paired project's transport/run authority. */
export function useAppShellGateway(fixture: AppShellFixtureProps) {
  const local = Boolean(fixture.fixtureMessages || fixture.fixtureGatewayStatus || fixture.fixtureProviderQuota
    || fixture.fixturePromptAttachments || fixture.fixtureUpdateNotice || fixture.fixtureProjectRailStartup
    || fixture.fixtureProjectRail || fixture.fixtureProjectFiles);
  const gateway = useGatewayWorkspace({ restorePersisted: !local });
  return { gateway, displayedRunActive: local ? Boolean(fixture.fixtureRunActive) : gateway.sending };
}
