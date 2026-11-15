import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readWalletState, walletStateDir, writeWalletState } from '../wallet-state-store.js';

const snapshot = {
  shieldedState: 'shielded-bytes', unshieldedState: 'unshielded-bytes',
  dustState: 'dust-bytes', unshieldedHistory: 'history-bytes', transactionLifecycleState: 'lifecycle-bytes',
};

describe('Ledger9 wallet snapshot boundary', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'resolver-ledger9-cache-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('roundtrips component, history and required lifecycle bytes', async () => {
    await writeWalletState(root, 'preprod', 'default', 'seedhash', snapshot);
    expect(await readWalletState(root, 'preprod', 'default', 'seedhash')).toMatchObject({
      ...snapshot, meta: { version: 3, walletSchema: 'ledger9-sdk5' },
    });
  });

  it('quarantines old Ledger8 bytes before resync without modifying seed/key files', async () => {
    const dir = await writeWalletState(root, 'preprod', 'default', 'seedhash', snapshot);
    const oldMeta = JSON.stringify({ version: 2, walletSchema: 'ledger8' });
    await writeFile(path.join(dir, 'meta.json'), oldMeta);
    const secrets = path.join(root, 'manager-secrets.json');
    await writeFile(secrets, 'preserved-secret-material');
    expect(await readWalletState(root, 'preprod', 'default', 'seedhash')).toBeNull();
    const backupRoot = path.join(root, 'backup', 'wallet-state', 'preprod', 'default');
    const [backup] = await readdir(backupRoot);
    expect(await readFile(path.join(backupRoot, backup, 'meta.json'), 'utf8')).toBe(oldMeta);
    expect(await readFile(path.join(backupRoot, backup, 'shielded.json'), 'utf8')).toBe(snapshot.shieldedState);
    expect(await readFile(secrets, 'utf8')).toBe('preserved-secret-material');
    await writeWalletState(root, 'preprod', 'default', 'seedhash', snapshot);
    expect(await readFile(path.join(backupRoot, backup, 'meta.json'), 'utf8')).toBe(oldMeta);
  });

  it('quarantines an incomplete or empty-lifecycle Ledger9 cache', async () => {
    const dir = walletStateDir(root, 'preprod', 'default', 'seedhash');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'meta.json'), '{}');
    expect(await readWalletState(root, 'preprod', 'default', 'seedhash')).toBeNull();
    await writeWalletState(root, 'preprod', 'default', 'seedhash', { ...snapshot, transactionLifecycleState: '' });
    expect(await readWalletState(root, 'preprod', 'default', 'seedhash')).toBeNull();
    expect(await readdir(path.join(root, 'backup', 'wallet-state', 'preprod', 'default'))).toHaveLength(2);
  });

  it('does not create a cache or backup when none exists', async () => {
    expect(await readWalletState(root, 'preprod', 'default', 'seedhash')).toBeNull();
    expect(await readdir(root)).toEqual([]);
  });
});
