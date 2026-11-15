import { Buffer } from "node:buffer";

import {
  ContractState,
  createConstructorContext,
} from "@midnight-ntwrk/compact-runtime";
import { MidnightNetwork } from "@midnight-ntwrk/midnight-did";
import { DIDContract, witnesses } from "@midnight-ntwrk/midnight-did-contract";
import { SerializedContractState } from "@midnight-ntwrk/midnight-js-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@midnight-ntwrk/midnight-js-indexer-public-data-provider", () => ({
  indexerPublicDataProvider: () => ({ queryContractState: query }),
}));
import { ResolverService } from "../service.js";

const address = "a".repeat(64);
const did = `did:midnight:undeployed:${address}`;
const service = () =>
  new ResolverService({
    indexerHttpUrl: "http://127.0.0.1:8088/api/v4/graphql",
    indexerWsUrl: "ws://127.0.0.1:8088/api/v4/graphql/ws",
    expectedNetwork: MidnightNetwork.Undeployed,
  });

describe("real owning Ledger9 state and resolution envelope", () => {
  beforeEach(() => query.mockReset());

  it("decodes published generated DID state, preserving version and document identity", async () => {
    const contract = new DIDContract.Contract(witnesses);
    const initial = await contract.initialState(
      createConstructorContext(
        {
          secretKey: new Uint8Array(32).fill(1),
          recoverySecretKey: new Uint8Array(32).fill(2),
        },
        "00".repeat(32),
      ),
    );
    query.mockResolvedValue({
      contractState: SerializedContractState.fromBytes(
        "v9",
        initial.currentContractState.serialize(),
      ),
    });
    const result = await service().resolve(did);
    expect(result.statusCode).toBe(200);
    expect(result.payload.didDocument?.id).toBe(did);
    expect(result.payload.didDocumentMetadata).toMatchObject({
      versionId: "0",
      deactivated: undefined,
    });
    expect(result.payload.didResolutionMetadata).toMatchObject({
      error: null,
      contentType: "application/did+ld+json",
    });
  });

  it("rejects a real Ledger8 serialized state without relabeling it", async () => {
    // Empty ContractState serialized by the baseline onchain-runtime-v3 3.0.0.
    const bytes = Buffer.from(
      "6d69646e696768743a636f6e74726163742d73746174655b76365d3a140004000400000404080104040820030408100104000010000c00001000000400",
      "hex",
    );
    query.mockResolvedValue({
      contractState: SerializedContractState.fromBytes("v8", bytes),
    });
    const result = await service().resolve(did);
    expect(result.statusCode).toBe(500);
    expect(result.payload).toMatchObject({
      didDocument: null,
      didDocumentMetadata: {},
      didResolutionMetadata: { error: "internalError" },
    });
  });

  it("rejects corrupt Ledger9 data and preserves missing-state semantics", async () => {
    const bytes = new ContractState().serialize();
    query.mockResolvedValueOnce({
      contractState: SerializedContractState.fromBytes(
        "v9",
        bytes.slice(0, -1),
      ),
    });
    expect(
      (await service().resolve(did)).payload.didResolutionMetadata.error,
    ).toBe("internalError");
    query.mockResolvedValueOnce(null);
    expect(await service().resolve(did)).toMatchObject({
      statusCode: 404,
      payload: {
        didDocument: null,
        didResolutionMetadata: { error: "notFound" },
      },
    });
  });

  it("rejects the wrong network before any indexer read", async () => {
    expect(
      await service().resolve(`did:midnight:preprod:${address}`),
    ).toMatchObject({
      statusCode: 400,
      payload: { didResolutionMetadata: { error: "networkMismatch" } },
    });
    expect(query).not.toHaveBeenCalled();
  });
});
