import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_FILES_COLUMN_WIDTH,
  MAX_FILES_COLUMN_WIDTH,
  MAX_PROJECTS_COLUMN_WIDTH,
  MIN_CONVERSATION_COLUMN_WIDTH,
  WORKSPACE_COLUMN_DIVIDER_WIDTH,
  defaultWorkspaceColumnPreferences,
  parsedWorkspaceColumnPreferences,
  workspaceColumnWidths,
} from './workspaceColumns';

function geometry(width: number, projectsVisible = true, filesVisible = true, projects = 224, files = width * 0.36) {
  return workspaceColumnWidths({ width, projectsVisible, filesVisible, preferredProjectsWidth: projects, preferredFilesWidth: files });
}

describe('workspace column geometry', () => {
  it.each([744, 820, 1024])('protects the conversation and never overcommits a %s-point iPad scene', (width) => {
    const result = geometry(width);
    expect(result.conversationWidth).toBeGreaterThanOrEqual(MIN_CONVERSATION_COLUMN_WIDTH);
    expect(result.projectsWidth + result.filesWidth + result.conversationWidth + 2 * WORKSPACE_COLUMN_DIVIDER_WIDTH).toBeCloseTo(width);
  });

  it('uses the established project width and a 36%-of-scene files default capped at 430', () => {
    expect(defaultWorkspaceColumnPreferences(1024)).toEqual({ projects: 224, files: 368.64 });
    expect(defaultWorkspaceColumnPreferences(1400)).toEqual({ projects: 224, files: DEFAULT_MAX_FILES_COLUMN_WIDTH });
  });

  it('lets narrow split view compress side minima without taking or inventing space', () => {
    const result = geometry(700);
    expect(result.projectsWidth).toBeLessThan(160);
    expect(result.filesWidth).toBeLessThan(240);
    expect(result.conversationWidth).toBe(MIN_CONVERSATION_COLUMN_WIDTH);
    expect(result.projectsWidth + result.filesWidth + result.conversationWidth + 2 * WORKSPACE_COLUMN_DIVIDER_WIDTH).toBeCloseTo(700);
  });

  it('makes hidden columns consume no width without changing the supplied preference', () => {
    expect(geometry(820, false, true, 310, 330)).toEqual({ projectsWidth: 0, conversationWidth: 820 - 330 - WORKSPACE_COLUMN_DIVIDER_WIDTH, filesWidth: 330 });
    expect(geometry(820, true, false, 310, 330)).toEqual({ projectsWidth: 310, conversationWidth: 820 - 310 - WORKSPACE_COLUMN_DIVIDER_WIDTH, filesWidth: 0 });
    expect(geometry(820, false, false, 310, 330)).toEqual({ projectsWidth: 0, conversationWidth: 820, filesWidth: 0 });
  });

  it('bounds corrupted or extreme persisted preferences before layout', () => {
    expect(parsedWorkspaceColumnPreferences('{"projects":9999,"files":-12}')).toEqual({ projects: MAX_PROJECTS_COLUMN_WIDTH, files: 240 });
    expect(parsedWorkspaceColumnPreferences('{"projects":"wide"}')).toBeNull();
    expect(parsedWorkspaceColumnPreferences('not json')).toBeNull();
  });

  it('allows a deliberate files preference beyond its 430-point default cap on a wide scene', () => {
    const result = geometry(1800, true, true, 224, 700);
    expect(result.filesWidth).toBe(700);
    expect(result.filesWidth).toBeGreaterThan(DEFAULT_MAX_FILES_COLUMN_WIDTH);
    expect(result.filesWidth).toBeLessThan(MAX_FILES_COLUMN_WIDTH);
  });
});
