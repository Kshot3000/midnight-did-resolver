import { Buffer } from "node:buffer";

import { ContractState, createConstructorContext } from '@midnight-ntwrk/compact-runtime';
import { DIDContract, witnesses } from '@midnight-ntwrk/midnight-did-contract';
import { SerializedContractState } from '@midnight-ntwrk/midnight-js-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyManagerHttpError } from '../errors.js';
import { createDidVerificationMethodResolver } from '../signatures/did-resolution.js';

const query = vi.hoisted(() => vi.fn());
vi.mock('@midnight-ntwrk/midnight-js-indexer-public-data-provider', () => ({
  indexerPublicDataProvider: () => ({ queryContractState: query }),
}));
const address = 'a'.repeat(64);
const resolver = () => createDidVerificationMethodResolver({
  setupProfile: 'standalone', indexerUrl: 'http://127.0.0.1:8088/api/v4/graphql',
  indexerWsUrl: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
});

describe('indexer-only manager signature resolution', () => {
  beforeEach(() => query.mockReset());
  it('uses owning SDK5 state decoding without a wallet and rejects an absent key', async () => {
    const initial = await new DIDContract.Contract(witnesses).initialState(createConstructorContext({
      secretKey: new Uint8Array(32).fill(1), recoverySecretKey: new Uint8Array(32).fill(2),
    }, '00'.repeat(32)));
    query.mockResolvedValue({ contractState: SerializedContractState.fromBytes('v9', initial.currentContractState.serialize()) });
    await expect(resolver()(`did:midnight:undeployed:${address}#missing`)).rejects.toThrow('was not found');
    expect(query).toHaveBeenCalledWith(address);
  });
  it('rejects wrong-network verification before querying', async () => {
    await expect(resolver()(`did:midnight:preprod:${address}#key`)).rejects.toThrow(/network/i);
    expect(query).not.toHaveBeenCalled();
  });
  it('reports unsupported old contracts explicitly without decoding them as Ledger9', async () => {
    const bytes = Buffer.from('6d69646e696768743a636f6e74726163742d73746174655b76365d3a140004000400000404080104040820030408100104000010000c00001000000400', 'hex');
    query.mockResolvedValue({ contractState: SerializedContractState.fromBytes('v8', bytes) });
    let caught: unknown;
    try { await resolver()(`did:midnight:undeployed:${address}#key`); } catch (error) { caught = error; }
    expect(classifyManagerHttpError(caught)).toMatchObject({
      statusCode: 400, errorCode: 'invalidRequest', message: expect.stringContaining('Ledger9 replacement'),
    });
  });
  it('rejects malformed state and verification identifiers', async () => {
    const bytes = new ContractState().serialize();
    query.mockResolvedValue({ contractState: SerializedContractState.fromBytes('v9', bytes.slice(0, -1)) });
    await expect(resolver()(`did:midnight:undeployed:${address}#key`)).rejects.toThrow();
    await expect(resolver()('not-a-did-url')).rejects.toThrow('absolute Midnight DID URL');
  });
});
