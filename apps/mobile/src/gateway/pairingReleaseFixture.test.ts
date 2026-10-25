// @ts-expect-error Node built-in types are intentionally absent from the app tsconfig.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the app tsconfig.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('pairing Release fixture', () => {
  it('drives the real PairingBar through the connecting state without replacing its layout', () => {
    const app = readFileSync(resolve(process.cwd(), 'App.tsx'), 'utf8');
    const shell = readFileSync(resolve(process.cwd(), 'src/app/AppShell.tsx'), 'utf8');
    const pairing = readFileSync(resolve(process.cwd(), 'src/gateway/PairingBar.tsx'), 'utf8');

    expect(app).toContain("fixtureMode === 'connecting-layout' ? 'connecting' : undefined");
    expect(shell).toContain('statusOverride={fixtureGatewayStatus}');
    expect(pairing).toContain('const status = statusOverride ?? gateway.status');
  });
});
