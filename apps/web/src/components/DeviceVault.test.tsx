import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceRecord } from '@sslm/store';
import { rememberOnDevice, resetSecretsForTests, secrets } from '../lib/secrets.ts';
import { store } from '../lib/store.ts';
import { RememberKeysCard, UnlockKeysBar } from './DeviceVault.tsx';

const workspace = (id: string): WorkspaceRecord => ({ id, name: 'Contoso', createdAt: '2026-10-25T10:00:00Z', updatedAt: '2026-10-25T10:00:00Z', isDemo: false, ld: { instance: 'us', projectKey: 'p' } });

describe('device vault UI', () => {
  beforeEach(resetSecretsForTests);
  afterEach(cleanup);

  it('shows the unlock bar only when keys are stored but locked, and reports a wrong passphrase', async () => {
    const id = `w-${crypto.randomUUID()}`;
    await store.createWorkspace({ id, name: `Contoso ${id}` });
    secrets.set('statsig', 'src-1', 'console-key', id);
    await rememberOnDevice(id, 'correct horse battery staple');
    resetSecretsForTests(); // the next tab
    render(<UnlockKeysBar workspaceId={id} workspace={workspace(id)} />);
    const input = await screen.findByLabelText('Passphrase');
    fireEvent.change(input, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toMatch(/passphrase doesn't unlock/);
    fireEvent.change(input, { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unlock keys' })).toBeNull());
    expect(secrets.get('statsig', 'src-1')).toBe('console-key');
  });

  it('stays hidden when nothing is stored', async () => {
    const id = `w-${crypto.randomUUID()}`;
    render(<UnlockKeysBar workspaceId={id} workspace={workspace(id)} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('region', { name: 'Unlock keys' })).toBeNull();
  });

  it('lets the user opt in with a confirmed passphrase and then forget', async () => {
    const id = `w-${crypto.randomUUID()}`;
    await store.createWorkspace({ id, name: `Contoso ${id}` });
    secrets.set('ld', id, 'api-ld-token');
    render(<RememberKeysCard workspaceId={id} workspace={workspace(id)} />);
    await screen.findByText(/Will remember the LaunchDarkly token/);
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'correct horse battery staple' } });
    fireEvent.change(screen.getByLabelText('Confirm'), { target: { value: 'different one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remember on this device' }));
    await screen.findByText('The passphrases differ.');
    fireEvent.change(screen.getByLabelText('Confirm'), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remember on this device' }));
    await screen.findByText(/remembered on this device and unlocked/);
    expect(await store.getVault(id)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Forget on this device' }));
    await screen.findByRole('button', { name: 'Remember on this device' });
    expect(await store.getVault(id)).toBeUndefined();
  });
});
