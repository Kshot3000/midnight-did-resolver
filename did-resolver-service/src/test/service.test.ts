import { ContractState } from "@midnight-ntwrk/compact-runtime";
import { SerializedContractState } from "@midnight-ntwrk/midnight-js-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveResultMock = vi.fn();
const queryContractStateMock = vi.fn();
const ledgerFromStateMock = vi.fn();
const resolverCtorMock = vi.fn();
const providerFactoryMock = vi.fn();

vi.mock("@midnight-ntwrk/midnight-did", () => {
  class MidnightDIDResolver {
    constructor(options: unknown) {
      resolverCtorMock(options);
    }

    resolveResult = resolveResultMock;
  }

  return {
    MidnightDIDResolver,
    MidnightNetwork: {
      DevNet: "devnet",
      Testnet: "testnet",
    },
  };
});

vi.mock("@midnight-ntwrk/midnight-js-indexer-public-data-provider", () => ({
  indexerPublicDataProvider: (...args: unknown[]) => {
    providerFactoryMock(...args);
    return {
      queryContractState: queryContractStateMock,
    };
  },
}));

vi.mock("@midnight-ntwrk/midnight-did-contract", () => ({
  DIDContract: {
    ledger: (...args: unknown[]) => ledgerFromStateMock(...args),
  },
}));

import { ResolverService } from "../service";

describe("did-resolver-service service", () => {
  beforeEach(() => {
    resolveResultMock.mockReset();
    queryContractStateMock.mockReset();
    ledgerFromStateMock.mockReset();
    resolverCtorMock.mockClear();
    providerFactoryMock.mockClear();
  });

  it("returns resolved DID document with DID content type", async () => {
    resolveResultMock.mockResolvedValue({
      didDocument: { id: "did:midnight:devnet:abc" },
      didDocumentMetadata: { versionId: "1" },
      didResolutionMetadata: { error: null },
    });

    const service = new ResolverService({
      indexerHttpUrl: "http://indexer.example/api/v3/graphql",
      indexerWsUrl: "ws://indexer.example/api/v3/graphql/ws",
    });

    const result = await service.resolve("did:midnight:devnet:abc");
    expect(result.statusCode).toBe(200);
    expect(result.payload.didResolutionMetadata).toEqual({
      contentType: "application/did+ld+json",
      error: null,
    });
  });

  it("maps null resolution to notFound", async () => {
    resolveResultMock.mockResolvedValue(null);
    const service = new ResolverService({
      indexerHttpUrl: "http://indexer.example/api/v3/graphql",
      indexerWsUrl: "ws://indexer.example/api/v3/graphql/ws",
    });

    const result = await service.resolve("did:midnight:devnet:abc");
    expect(result.statusCode).toBe(404);
    expect(result.payload.didResolutionMetadata.error).toBe("notFound");
  });

  it("reuses resolver instances for same endpoint pair", async () => {
    resolveResultMock.mockResolvedValue(null);
    const service = new ResolverService({
      indexerHttpUrl: "http://indexer.example/api/v3/graphql",
      indexerWsUrl: "ws://indexer.example/api/v3/graphql/ws",
    });

    await service.resolve("did:midnight:devnet:abc");
    await service.resolve("did:midnight:devnet:def");

    expect(resolverCtorMock).toHaveBeenCalledTimes(1);
  });

  it("decodes era-tagged SDK5 state with the owning Compact runtime", async () => {
    resolveResultMock.mockResolvedValue(null);
    const contractState = new ContractState();
    queryContractStateMock.mockResolvedValueOnce({
      contractState: SerializedContractState.fromBytes(
        "v9",
        contractState.serialize(),
      ),
    });
    ledgerFromStateMock.mockReturnValue({ ledger: "mapped" });
    const service = new ResolverService({
      indexerHttpUrl: "http://indexer.example/api/v4/graphql",
      indexerWsUrl: "ws://indexer.example/api/v4/graphql/ws",
    });
    await service.resolve("did:midnight:devnet:abc");
    const { ledgerReader } = resolverCtorMock.mock.calls[0][0];
    await expect(ledgerReader("contract-address")).resolves.toEqual({
      ledger: "mapped",
    });
    expect(ledgerFromStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ state: expect.any(Object) }),
    );
    queryContractStateMock.mockResolvedValueOnce(null);
    await expect(ledgerReader("missing-address")).resolves.toBeNull();
  });

  it("rejects legacy decoded objects and malformed serialized state", async () => {
    resolveResultMock.mockResolvedValue(null);
    const service = new ResolverService({
      indexerHttpUrl: "http://indexer.example/api/v4/graphql",
      indexerWsUrl: "ws://indexer.example/api/v4/graphql/ws",
    });
    await service.resolve("did:midnight:devnet:abc");
    const { ledgerReader } = resolverCtorMock.mock.calls[0][0];
    for (const invalid of [
      {},
      new ContractState(),
      { data: new ContractState().data },
    ]) {
      queryContractStateMock.mockResolvedValueOnce(invalid);
      await expect(ledgerReader("contract-address")).rejects.toThrow();
    }
    const bytes = new ContractState().serialize();
    queryContractStateMock.mockResolvedValueOnce({
      contractState: SerializedContractState.fromBytes(
        "v9",
        bytes.slice(0, bytes.length - 1),
      ),
    });
    await expect(ledgerReader("contract-address")).rejects.toThrow();
    expect(ledgerFromStateMock).not.toHaveBeenCalled();
  });

  it("maps validation/network/internal errors to expected DID errors", async () => {
    const service = new ResolverService({
      indexerHttpUrl: "http://indexer.example/api/v3/graphql",
      indexerWsUrl: "ws://indexer.example/api/v3/graphql/ws",
    });

    resolveResultMock.mockRejectedValueOnce(
      new Error("Invalid Midnight DID format"),
    );
    resolveResultMock.mockRejectedValueOnce(new Error("Network mismatch"));
    resolveResultMock.mockRejectedValueOnce(new Error("boom"));

    const invalidDid = await service.resolve("did:bad");
    const networkMismatch = await service.resolve("did:midnight:devnet:abc");
    const internalError = await service.resolve("did:midnight:devnet:abc");

    expect(invalidDid.statusCode).toBe(400);
    expect(invalidDid.payload.didResolutionMetadata.error).toBe("invalidDid");

    expect(networkMismatch.statusCode).toBe(400);
    expect(networkMismatch.payload.didResolutionMetadata.error).toBe(
      "networkMismatch",
    );

    expect(internalError.statusCode).toBe(500);
    expect(internalError.payload.didResolutionMetadata.error).toBe(
      "internalError",
    );
  });

  it("uses injected logger for debug error output", async () => {
    const logger = { error: vi.fn() };
    const service = new ResolverService({
      indexerHttpUrl: "http://indexer.example/api/v3/graphql",
      indexerWsUrl: "ws://indexer.example/api/v3/graphql/ws",
      debug: true,
      logger,
    });

    resolveResultMock.mockRejectedValueOnce(new Error("boom"));
    await service.resolve("did:midnight:devnet:abc");

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "[did-resolver-service] resolve failed",
      expect.objectContaining({
        did: "did:midnight:devnet:abc",
        errorCode: "internalError",
        message: "boom",
      }),
    );
  });

  it("times out slow resolutions and returns internalError", async () => {
    resolveResultMock.mockImplementation(
      () => new Promise(() => undefined) as Promise<never>,
    );
    const service = new ResolverService({
      indexerHttpUrl: "http://indexer.example/api/v3/graphql",
      indexerWsUrl: "ws://indexer.example/api/v3/graphql/ws",
      resolveTimeoutMs: 5,
    });

    const result = await service.resolve("did:midnight:devnet:abc");
    expect(result.statusCode).toBe(500);
    expect(result.payload.didResolutionMetadata.error).toBe("internalError");
  });
});
