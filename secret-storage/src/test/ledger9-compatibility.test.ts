import {
  deriveJubjubPublicKeyFromSeed,
  encodeJubjubSignature,
  signJubjubPayloadFromSeed,
  verifyJubjubPayload,
} from "@midnight-ntwrk/midnight-did-jubjub-schnorr";
import { describe, expect, it } from "vitest";

import { deriveCurvePrivateFromSeed } from "../hd-derivation.js";

// Frozen against the pre-upgrade public HD3.0.2/DID0.7.0 packages, independently
// compared with HD4.0.0/DID1.0.0-rc1. Never regenerate these from only the new stack.
const seedHex =
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const vectors = [
  {
    kty: "OKP",
    crv: "Ed25519",
    account: 0,
    index: 0,
    candidate: 0,
    privateKeyHex:
      "b021ebad1fb38fc20e6280c41307d948a1176f12c7e4712952a2c63026d56562",
  },
  {
    kty: "OKP",
    crv: "Ed25519",
    account: 1,
    index: 2,
    candidate: 0,
    privateKeyHex:
      "4971e78d162e034c684ea90103449872f9c21fecb7449cbb577433929b4cd67b",
  },
  {
    kty: "OKP",
    crv: "Ed25519",
    account: 1,
    index: 2,
    candidate: 3,
    privateKeyHex:
      "15a2a10c62e528c252a016214a3424595ba280f2ce886ee3ea8293bc5b03f122",
  },
  {
    kty: "EC",
    crv: "Jubjub",
    account: 0,
    index: 0,
    candidate: 0,
    privateKeyHex:
      "1e7a636581f7d8b12be7dbde371f5e0bce4bee3df2ea55438eeb570d9788c11e",
  },
  {
    kty: "EC",
    crv: "Jubjub",
    account: 1,
    index: 2,
    candidate: 0,
    privateKeyHex:
      "a262476dd62f4fcbe2ce67b5593a315ad011ea5abf9e2a66e0ef4a67d152342a",
  },
  {
    kty: "EC",
    crv: "Jubjub",
    account: 1,
    index: 2,
    candidate: 3,
    privateKeyHex:
      "0f1cd9c552c4e6649391296f429b7cb0d293082813c9221d3cf1733398bb4e19",
  },
  {
    kty: "EC",
    crv: "P-256",
    account: 0,
    index: 0,
    candidate: 0,
    privateKeyHex:
      "d806d57605797249d900f51d8ab2900f9aea8c08fa0287a7d932095b85cb73c7",
  },
  {
    kty: "EC",
    crv: "P-256",
    account: 1,
    index: 2,
    candidate: 0,
    privateKeyHex:
      "0aaa6d369e2ea21c4d988958aae45e3b1609208e0b0491040e4bf3ba9cd83780",
  },
  {
    kty: "EC",
    crv: "P-256",
    account: 1,
    index: 2,
    candidate: 3,
    privateKeyHex:
      "449a04f0482ba233bea2c55f434b224d7d266d5ba91e3378583088cf4ebfac8c",
  },
] as const;

describe("Ledger9 deterministic compatibility", () => {
  it.each(vectors)(
    "preserves $crv account $account/index $index/candidate $candidate",
    (vector) => {
      const derived = deriveCurvePrivateFromSeed(
        { id: "compatibility", seedHex, ...vector },
        vector.candidate,
      );
      expect(Buffer.from(derived.privateKey).toString("hex")).toBe(
        vector.privateKeyHex,
      );
    },
  );

  it("preserves canonical Jubjub native point and signature bytes", async () => {
    const seed = Buffer.from(seedHex, "hex");
    const payload = Buffer.from(
      "4c656467657239207365637265742d73746f7261676520636f6d7061746962696c697479",
      "hex",
    );
    const publicKey = await deriveJubjubPublicKeyFromSeed(seed);
    expect(publicKey).toEqual({
      x: 15440488656503563475770596958543487820209058860932037751440168630493278720967n,
      y: 38889778633847659651168693437712771375392931376764677020227086876631304851243n,
    });
    const signature = await signJubjubPayloadFromSeed(seed, payload);
    expect(Buffer.from(encodeJubjubSignature(signature)).toString("hex")).toBe(
      "00812f2a5a20fd52359d115d3344172f456888228b8e02cb62580d7b63fd83973fab163cc6b51219829d85239cc39a54d5e4d9c619b09d3dbb912de4e745579708046c82e70e4809756fbc72431d20096598b655de0ed1f0e3daa48884a9d2c7",
    );
    expect(await verifyJubjubPayload(publicKey, payload, signature)).toBe(true);
  });
});
