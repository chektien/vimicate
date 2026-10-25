export function arrayAt(payload: Record<string, unknown>, keys: string[]) { for (const key of keys) if (Array.isArray(payload[key])) return payload[key] as unknown[]; return []; }
export function stringAt(value: Record<string, unknown>, keys: string[]) { for (const key of keys) if (typeof value[key] === 'string') return value[key] as string; return ''; }
export function numberAt(value: Record<string, unknown>, keys: string[]) { for (const key of keys) if (typeof value[key] === 'number') return value[key] as number; return 0; }
export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
