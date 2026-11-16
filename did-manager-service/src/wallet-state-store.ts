import { createHash, randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { MidnightWalletStateSnapshot } from '@midnight-ntwrk/midnight-did-api';

import type { NetworkProfile } from './types.js';

export type WalletStateMeta = {
  version: 3;
  walletSchema: 'ledger9-sdk5';
  profile: NetworkProfile;
  profileName: string;
  seedHash: string;
  updatedAt: string;
};

export type StoredWalletState = MidnightWalletStateSnapshot & {
  meta: WalletStateMeta;
};

export const seedHashPrefix = (seed: string): string =>
  createHash('sha256').update(seed).digest('hex').slice(0, 6);

export const privateStateDbSeedHash = (seed: string): string =>
  createHash('sha256').update(seed).digest('hex').slice(0, 16);

export const walletStateDir = (
  baseDir: string,
  network: NetworkProfile,
  profileName: string,
  seedHash: string,
): string => path.join(baseDir, 'profiles', network, profileName, 'wallet-state', seedHash);

const metaFilePath = (dir: string): string => path.join(dir, 'meta.json');
const shieldedFilePath = (dir: string): string => path.join(dir, 'shielded.json');
const unshieldedFilePath = (dir: string): string => path.join(dir, 'unshielded.json');
const dustFilePath = (dir: string): string => path.join(dir, 'dust.json');
const historyFilePath = (dir: string): string => path.join(dir, 'unshielded-history.json');
const lifecycleFilePath = (dir: string): string => path.join(dir, 'transaction-lifecycle.json');

export const readWalletState = async (
  baseDir: string,
  network: NetworkProfile,
  profileName: string,
  seedHash: string,
): Promise<StoredWalletState | null> => {
  const dir = walletStateDir(baseDir, network, profileName, seedHash);
  try {
    const [metaRaw, shieldedState, unshieldedState, dustState, transactionLifecycleState] = await Promise.all([
      readFile(metaFilePath(dir), 'utf8'),
      readFile(shieldedFilePath(dir), 'utf8'),
      readFile(unshieldedFilePath(dir), 'utf8'),
      readFile(dustFilePath(dir), 'utf8'),
      readFile(lifecycleFilePath(dir), 'utf8'),
    ]);
    const meta = JSON.parse(metaRaw) as WalletStateMeta;
    const unshieldedHistory = await readFile(historyFilePath(dir), 'utf8').catch(() => undefined);
    if (
      meta.version !== 3
      || meta.walletSchema !== 'ledger9-sdk5'
      || transactionLifecycleState.trim().length === 0
      || meta.profile !== network
      || meta.profileName !== profileName
      || meta.seedHash !== seedHash
    ) {
      throw new Error('Incompatible wallet snapshot');
    }
    return {
      meta,
      transactionLifecycleState,
      shieldedState,
      unshieldedState,
      dustState,
      unshieldedHistory,
    };
  } catch {
    // Quarantine the entire cache before fresh sync can overwrite it. A failed
    // rename is fatal; never lose the only old snapshot or touch seed/key files.
    const exists = await stat(dir).then(() => true, (error: { code?: string }) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    if (exists) {
      const backupRoot = path.join(baseDir, 'backup', 'wallet-state', network, profileName);
      await mkdir(backupRoot, { recursive: true, mode: 0o700 });
      await rename(dir, path.join(backupRoot, `${seedHash}-incompatible-${randomUUID()}`));
    }
    return null;
  }
};

export const writeWalletState = async (
  baseDir: string,
  network: NetworkProfile,
  profileName: string,
  seedHash: string,
  snapshot: MidnightWalletStateSnapshot,
): Promise<string> => {
  const dir = walletStateDir(baseDir, network, profileName, seedHash);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const meta: WalletStateMeta = {
    version: 3,
    walletSchema: 'ledger9-sdk5',
    profile: network,
    profileName,
    seedHash,
    updatedAt: new Date().toISOString(),
  };
  await Promise.all([
    writeFile(metaFilePath(dir), JSON.stringify(meta, null, 2), { encoding: 'utf8', mode: 0o600 }),
    writeFile(shieldedFilePath(dir), snapshot.shieldedState, { encoding: 'utf8', mode: 0o600 }),
    writeFile(unshieldedFilePath(dir), snapshot.unshieldedState, { encoding: 'utf8', mode: 0o600 }),
    writeFile(dustFilePath(dir), snapshot.dustState, { encoding: 'utf8', mode: 0o600 }),
    writeFile(historyFilePath(dir), snapshot.unshieldedHistory ?? '', { encoding: 'utf8', mode: 0o600 }),
    writeFile(lifecycleFilePath(dir), snapshot.transactionLifecycleState, { encoding: 'utf8', mode: 0o600 }),
  ]);
  return dir;
};

export const backupDirectoryIfExists = async (
  sourceDir: string,
  backupRootDir: string,
): Promise<string | null> => {
  try {
    const sourceStats = await stat(sourceDir);
    if (!sourceStats.isDirectory()) return null;
  } catch {
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(backupRootDir, timestamp);
  await mkdir(backupDir, { recursive: true });
  await cp(sourceDir, path.join(backupDir, path.basename(sourceDir)), { recursive: true });
  return backupDir;
};

export const removeWalletStateDir = async (
  baseDir: string,
  network: NetworkProfile,
  profileName: string,
  seedHash: string,
): Promise<void> => {
  await rm(walletStateDir(baseDir, network, profileName, seedHash), { recursive: true, force: true });
};

export const copyWalletStateFile = async (fromPath: string, toPath: string): Promise<void> => {
  await mkdir(path.dirname(toPath), { recursive: true });
  await copyFile(fromPath, toPath);
};
