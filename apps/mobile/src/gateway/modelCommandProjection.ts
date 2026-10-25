import type { ModelChoice } from './modelMatching';
export type ModelCommandIntent =
  | { type: 'catalog' }
  | { type: 'switch'; model: string | null; displayText: string };

/**
 * The Gateway resets a thread to its configured default only when
 * `sessions.patch` carries `model: null`. A literal "default" string is
 * resolved as a model id (`<defaultProvider>/default`) and rejected.
 */
const DEFAULT_MODEL_KEYWORD = 'default';

/** The two colon commands that address the configured provider/model catalog. */
export function isModelCommandName(commandToken: string) {
  const name = commandToken.trim().replace(/^:/, '').toLocaleLowerCase();
  return name === 'model' || name === 'models';
}

export function modelCommandIntent(commandToken: string, argumentsText: string): ModelCommandIntent | null {
  const name = commandToken.trim().replace(/^:/, '').toLocaleLowerCase();
  const choice = argumentsText.trim();
  if (name === 'models' && !choice) return { type: 'catalog' };
  if (!isModelCommandName(name) || !choice) return null;
  if (choice.toLocaleLowerCase() === DEFAULT_MODEL_KEYWORD) {
    return {
      type: 'switch',
      model: null,
      displayText: ':model default — reset this thread to the configured default model.',
    };
  }
  return {
    type: 'switch',
    model: choice,
    displayText: `:model ${choice} — changed this thread to ${choice}.`,
  };
}

export function modelCatalogText(payload: Record<string, unknown>) {
  const choices = modelChoicesFromPayload(payload);
  return [
    ':models — configured OpenClaw model choices',
    'Yank a line below and paste it into the colon command bar.',
    '',
    `model ${DEFAULT_MODEL_KEYWORD}`,
    ...(choices.length ? choices.map((choice) => `model ${choice}`) : ['No configured model choices were returned.']),
  ].join('\n');
}

export function modelChoicesFromPayload(payload: Record<string, unknown>) {
  return modelCatalogEntriesFromPayload(payload).map(choice => choice.value);
}

export function modelCatalogEntriesFromPayload(payload: Record<string, unknown>) {
  const root = record(payload.result);
  const rows = Array.isArray(payload.models) ? payload.models : Array.isArray(root.models) ? root.models : [];
  const choices: Exclude<ModelChoice, string>[] = [];
  const seen = new Set<string>();
  for (const value of rows) {
    const model = record(value);
    const provider = text(model.provider);
    const id = text(model.id) || text(model.modelId) || text(model.model);
    const choice = id.includes('/') ? id : provider && id ? `${provider}/${id}` : '';
    if (!choice || seen.has(choice)) continue;
    seen.add(choice);
    const aliases = [text(model.alias), ...(Array.isArray(model.aliases) ? model.aliases.map(text) : [])].filter(Boolean);
    choices.push({ value: choice, ...(text(model.name) ? { name: text(model.name) } : {}), ...(aliases.length ? { aliases } : {}) });
  }
  return choices;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
