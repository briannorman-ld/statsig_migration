/**
 * Live, READ-ONLY checks against a real LaunchDarkly account (PLAN §16 "LD sandbox projects").
 * Run with `pnpm test:live`. Reads LD_API_TOKEN from .env.local. The token is never printed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LdClient, probeCapabilities, type LdInstanceId } from '../src/index.ts';

function loadEnvLocal(): Record<string, string> {
  const path = fileURLToPath(new URL('../../../.env.local', import.meta.url));
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith('#')) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnvLocal(), ...process.env };
const token = env.LD_API_TOKEN ?? '';
const enabled = process.env.LIVE === '1' && token.length > 0;

describe.skipIf(!enabled)('LaunchDarkly live (read-only)', () => {
  const client = new LdClient({ instance: (env.LD_INSTANCE || 'us') as LdInstanceId, token });

  it('identifies the token and probes capabilities without leaking secrets', async () => {
    const identity = await client.callerIdentity();
    expect(identity.tokenKind ?? identity.authKind).toBeTruthy();

    const projects = await client.listProjects();
    expect(projects.length).toBeGreaterThan(0);
    const projectKey = env.LD_PROJECT_KEY || projects[0]!.key;

    const matrix = await probeCapabilities(client, projectKey);
    const dump = JSON.stringify({ identity, projects, matrix });
    expect(dump).not.toContain(token);
    expect(dump).not.toMatch(/"(apiKey|mobileKey)"/);
    expect(dump).not.toMatch(/sdk-[0-9a-f]{8}-/);

    // Report (no secrets): token kind, project count, capability statuses.
    console.log(
      JSON.stringify(
        {
          token: { ...matrix.token, tokenId: matrix.token.tokenId ? '…' + matrix.token.tokenId.slice(-4) : undefined },
          projectsVisible: projects.length,
          probedProject: `${matrix.projectKey} (${matrix.projectName})`,
          environments: matrix.environments,
          projectAccessDenied: matrix.projectAccess.denied,
          capabilities: Object.fromEntries(matrix.capabilities.map((c) => [c.key, `${c.status} — ${c.evidence}`])),
          probes: matrix.probes,
          transport: client.transport.stats,
        },
        null,
        2,
      ),
    );
  });
});
