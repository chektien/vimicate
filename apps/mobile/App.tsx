import { SimulatorFilePreviewFixture } from './src/app/SimulatorFilePreviewFixture';
import { SimulatorCommandCompletionFixture } from './src/app/SimulatorCommandCompletionFixture';
import ConnectionHeaderProbe, { CONNECTION_HEADER_PROBE_MODE } from './scripts/fixtures/ConnectionHeaderProbe';
import { SimulatorTouchFixtureApp, SIMULATOR_TOUCH_FIXTURE_MODE } from './src/app/simulatorTouchFixtures';
import { SimulatorProjectFilesFixtureApp, SIMULATOR_PROJECT_FILE_LINKS_FIXTURE_MODE, SIMULATOR_PROJECT_FILES_FIXTURE_MODE } from './src/app/simulatorProjectFilesFixture';
import { SimulatorWorkspaceMediaFixtureApp } from './src/app/simulatorWorkspaceMediaFixtureApp';
import TranscriptSessionReviewProbe, { isSimulatorReviewFixtureMode } from './scripts/fixtures/TranscriptSessionReviewProbe';
import { SimulatorOwnershipFixtureApp, SIMULATOR_OWNERSHIP_FIXTURE_MODE } from './src/app/simulatorOwnershipFixtures';
import { SimulatorRecoveryFixtureApp } from './src/app/simulatorRecoveryFixtures';
import { SimulatorTranscriptFixtureApp } from './src/app/SimulatorTranscriptFixtureApp';
import { SIMULATOR_TRANSCRIPT_FIXTURE_MODE, SIMULATOR_TRANSCRIPT_GEOMETRY_MODE } from './src/app/simulatorTranscriptFixtures';
import { isSimulatorRecoveryFixtureMode } from './src/app/simulatorRecoveryFixtureData';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SimulatorDynamicFixtureApp } from './src/app/simulatorDynamicFixtures';
import { isSimulatorDynamicFixtureMode } from './src/app/simulatorDynamicFixtureData';
import { SIMULATOR_WORKSPACE_MEDIA_FIXTURE_MODE, simulatorWorkspaceMediaStartup, simulatorWorkspaceMediaProjectRail } from './src/app/simulatorWorkspaceMediaFixtures';
import { AppShell } from './src/app/AppShell';
import {
  FAILED_WAIT_SETTLEMENT_TICK,
  fixtureMessagesForMode,
  fixtureRunActiveForMode,
  fixtureTickingForMode,
} from './src/app/uiFixtureMessages';
import type { ProviderQuotaPresentation } from './src/gateway/providerQuota';
import { appUpdateNoticePresentation } from './src/updates/appUpdateNoticePresentation';
import type { AppUpdateNoticeController } from './src/updates/useAppUpdateNotice';
import {
  ATTACHMENT_GEOMETRY_SECOND_TICK,
  attentionProjectRailFixture,
  promptAttachmentGeometryFixture,
} from './src/app/appShellFixtures';

const statusQuotaFixture: ProviderQuotaPresentation = {
  provider: 'openai',
  text: '5h 82% 1h43m · 7d 51% 4d',
  tone: 'normal',
};

const interactionUpdateFixture: AppUpdateNoticeController = {
  presentation: appUpdateNoticePresentation({
    pending: true,
    dismissed: false,
    restartHold: null,
    restarting: false,
    releaseTitle: 'Transcript interaction polish',
    fixes: [
      'Show the actual invoked skill name',
      'Remove redundant image captions',
      'Preview staged images before sending',
    ],
    updateLabel: '01a04799-fixture',
  }),
  expanded: false,
  toggleNotes: () => undefined,
  showNotes: () => 'update notes opened',
  dismiss: () => undefined,
  restart: async () => undefined,
  check: async () => 'fixture update ready',
};

export default function App() {
  const fixtureMode = process.env.EXPO_PUBLIC_VIMICATE_UI_FIXTURE;
  const [streamTick, setStreamTick] = useState(0);
  const [fixtureNotesExpanded, setFixtureNotesExpanded] = useState(false);
  useEffect(() => {
    if (fixtureMode === SIMULATOR_WORKSPACE_MEDIA_FIXTURE_MODE || !fixtureTickingForMode(fixtureMode)) return undefined;
    const stress = fixtureMode === 'streaming-input-stress'
      || fixtureMode === 'physical-transcript-pressure'
      || fixtureMode === 'accepted-prompt-window-stress'
      || fixtureMode === 'queued-prompt-streaming-stress'
      || fixtureMode === 'flashlist-live-publication-stress'
      || fixtureMode === 'flashlist-terminal-publication-stress'
      || fixtureMode === 'flashlist-terminal-publication-pressure';
    // Give the physical 480-row same-height replay enough time to reach its
    // bounded tail and keep the 20K rich-publication replay active through
    // physical long-draft editing before either fixture settles.
    const extendedPhysicalStress = fixtureMode === 'physical-transcript-pressure'
      || fixtureMode === 'flashlist-live-publication-stress';
    const limit = fixtureMode === SIMULATOR_WORKSPACE_MEDIA_FIXTURE_MODE ? 240
      : fixtureMode === 'failed-run-settlement-transition' ? FAILED_WAIT_SETTLEMENT_TICK
      : fixtureMode === 'prompt-attachment-geometry-transition' ? ATTACHMENT_GEOMETRY_SECOND_TICK
      : extendedPhysicalStress ? 2_400 : stress ? 600 : 120;
    const timer = setInterval(() => setStreamTick((current) => Math.min(limit, current + 1)), stress ? 16 : 180);
    return () => clearInterval(timer);
  }, [fixtureMode]);
  const fixtureMessages = useMemo(() => fixtureMessagesForMode(fixtureMode, streamTick), [fixtureMode, streamTick]);
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {fixtureMode === 'qa-html-preview-v1' ? <SimulatorFilePreviewFixture htmlPreview /> : fixtureMode === 'qa-file-previews-xlsx-v1' ? <SimulatorFilePreviewFixture xlsx /> : fixtureMode === 'qa-file-previews-v1' ? <SimulatorFilePreviewFixture /> : fixtureMode === 'qa-command-completion-v1' ? <SimulatorCommandCompletionFixture /> : fixtureMode === CONNECTION_HEADER_PROBE_MODE ? <ConnectionHeaderProbe /> : fixtureMode === SIMULATOR_PROJECT_FILE_LINKS_FIXTURE_MODE ? <SimulatorProjectFilesFixtureApp linkedDocuments /> : fixtureMode === SIMULATOR_PROJECT_FILES_FIXTURE_MODE ? <SimulatorProjectFilesFixtureApp /> : fixtureMode === SIMULATOR_TOUCH_FIXTURE_MODE ? <SimulatorTouchFixtureApp /> : fixtureMode === SIMULATOR_WORKSPACE_MEDIA_FIXTURE_MODE ? <SimulatorWorkspaceMediaFixtureApp /> : fixtureMode === SIMULATOR_TRANSCRIPT_FIXTURE_MODE ? <SimulatorTranscriptFixtureApp /> : fixtureMode === SIMULATOR_TRANSCRIPT_GEOMETRY_MODE ? <SimulatorTranscriptFixtureApp geometry /> : isSimulatorReviewFixtureMode(fixtureMode) ? <TranscriptSessionReviewProbe /> : fixtureMode === SIMULATOR_OWNERSHIP_FIXTURE_MODE ? <SimulatorOwnershipFixtureApp /> : isSimulatorRecoveryFixtureMode(fixtureMode) ? <SimulatorRecoveryFixtureApp /> : isSimulatorDynamicFixtureMode(fixtureMode) ? <SimulatorDynamicFixtureApp /> : <AppShell fixtureMessages={fixtureMessages} fixtureRunActive={fixtureRunActiveForMode(fixtureMode, streamTick)} fixtureGatewayStatus={fixtureMode === 'connecting-layout' ? 'connecting' : undefined} fixtureProviderQuota={fixtureMode === 'status-quota' ? statusQuotaFixture : undefined} fixturePromptAttachments={promptAttachmentGeometryFixture(fixtureMode, streamTick)} fixtureUpdateNotice={fixtureMode === 'interaction-polish' ? { ...interactionUpdateFixture, expanded: fixtureNotesExpanded, toggleNotes: () => setFixtureNotesExpanded((current) => !current), showNotes: () => { setFixtureNotesExpanded(true); return 'update notes opened'; } } : undefined} fixtureProjectRailStartup={fixtureMode === SIMULATOR_WORKSPACE_MEDIA_FIXTURE_MODE ? simulatorWorkspaceMediaStartup(streamTick) : fixtureMode === 'project-rail-loading' ? { paired: true, registryReady: false } : undefined} fixtureProjectRail={fixtureMode === SIMULATOR_WORKSPACE_MEDIA_FIXTURE_MODE ? simulatorWorkspaceMediaProjectRail(streamTick) : fixtureMode === 'attention-unread' ? attentionProjectRailFixture : undefined} />}
    </SafeAreaProvider>
  );
}
