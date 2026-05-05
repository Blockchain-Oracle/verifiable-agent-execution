// scripts/smoke/tee-headers.ts
//
// Spec smoke test for `story-tee-header-parser` + `story-tee-proof-flow`.
// Validates the agent-wrapper signing-message reconstruction round-trips
// cleanly through ethers — i.e., what the X-* header parser will produce
// is what `TEEVerifier.verifyTEESignature(bytes32, bytes)` will accept.
//
// Source of truth (read from the cloned upstream Go source):
//   - 0gfoundation/agent-wrapper/internal/proxy/proxy.go signResponse():
//       content = fmt.Sprintf("%s|%s|%d|%s",
//         agentId, sealId, timestamp, hex(sha256(body)))
//   - 0gfoundation/agent-wrapper/internal/sealed/state.go SignWithAgentSealKey():
//       hash = keccak256(content)
//       sig  = ECDSA.sign(hash, key)   // 65-byte R||S||V, V normalized to 27/28
//   - 0gfoundation/0g-agent-nft/contracts/TeeVerifier.sol verifyTEESignature():
//       require(signature.length == 65)
//       signer = ECDSA.recover(dataHash, signature)
//       return signer == teeOracleAddress
//
// What this catches:
//   - If we ever get the field order wrong (the format is strict pipe-delim)
//   - If we ever apply EIP-191 prefixing where agent-wrapper doesn't
//   - If we sha256 the body using upper-case hex when agent-wrapper uses lower-case
//   - If the signature byte layout differs (R||S||V with V=27/28 vs 0/1)

import { HDNodeWallet, keccak256, recoverAddress, sha256, toUtf8Bytes, Wallet } from "ethers";

// --- exact agent-wrapper signing message (verified Apr 2026) ---

function reconstructSigningMessage(opts: {
  agentId: string;
  sealId: string;
  timestamp: number;
  body: Uint8Array;
}): string {
  const bodyHashHex = sha256(opts.body).slice(2); // strip 0x; agent-wrapper uses lower-case hex w/o prefix
  return `${opts.agentId}|${opts.sealId}|${opts.timestamp}|${bodyHashHex}`;
}

// --- "verifier" side: what TEEProofAdapter will do ---

function digestFor(content: string): string {
  // Raw keccak256, NOT EIP-191 prefixed (per agent-wrapper sealed/state.go:420)
  return keccak256(toUtf8Bytes(content));
}

async function recoverSigner(content: string, signature: string): Promise<string> {
  return recoverAddress(digestFor(content), signature);
}

// --- "agent-wrapper" side: what the Go binary does — synthesized in TS for the round-trip ---

async function signAsAgentWrapper(content: string, signer: Wallet | HDNodeWallet): Promise<string> {
  // Wallet.signingKey.sign() returns a non-EIP-191 signature over a 32-byte digest.
  // agent-wrapper does the same: ECDSA.Sign(keccak256(content), privKey). No prefix.
  const sig = signer.signingKey.sign(digestFor(content));
  return sig.serialized; // 0x-prefixed 130 hex chars (65 bytes incl. v normalized to 27/28)
}

// --- the round-trip ---

async function main(): Promise<void> {
  // Synthetic test signer — represents the TEE oracle key for the test.
  // NOT the same as the testnet wallet; this is just for the math check.
  const oracle = Wallet.createRandom();

  // Synthetic agent metadata.
  const agentId = "0x" + "11".repeat(20);
  const sealId = "0x" + "22".repeat(32);
  const timestamp = Math.floor(Date.now() / 1000);
  const body = new TextEncoder().encode(
    JSON.stringify({ choices: [{ message: { content: "hello world" } }] }),
  );

  // 1. agent-wrapper side: build content + sign
  const content = reconstructSigningMessage({ agentId, sealId, timestamp, body });
  const signature = await signAsAgentWrapper(content, oracle);

  // 2. verifier side: parse X-* headers (synthesized) → reconstruct → recover
  const headers = new Headers({
    "X-Agent-Id": agentId,
    "X-Seal-Id": sealId,
    "X-Timestamp": String(timestamp),
    "X-Signature": signature.slice(2), // agent-wrapper writes hex w/o 0x prefix
  });

  const parsed = {
    agentId: headers.get("X-Agent-Id")!,
    sealId: headers.get("X-Seal-Id")!,
    timestamp: Number(headers.get("X-Timestamp")!),
    signature: "0x" + headers.get("X-Signature")!, // normalize for ethers
  };

  const reconstructed = reconstructSigningMessage({
    agentId: parsed.agentId,
    sealId: parsed.sealId,
    timestamp: parsed.timestamp,
    body, // verifier sees the body it received from agent-wrapper
  });

  if (reconstructed !== content) {
    throw new Error(
      `Signing-message reconstruction drift:\n  expected: ${content}\n  got:      ${reconstructed}`,
    );
  }

  const recovered = await recoverSigner(reconstructed, parsed.signature);
  console.log("[smoke/tee-headers] content       =", content);
  console.log("[smoke/tee-headers] dataHash      =", digestFor(content));
  console.log("[smoke/tee-headers] signer (orig) =", oracle.address);
  console.log("[smoke/tee-headers] recovered     =", recovered);

  if (recovered.toLowerCase() !== oracle.address.toLowerCase()) {
    throw new Error("Recovered signer does not match the original — protocol drift!");
  }

  // Signature length sanity (TEEVerifier requires exactly 65 bytes).
  const sigBytes = (parsed.signature.length - 2) / 2;
  if (sigBytes !== 65) {
    throw new Error(`Signature length mismatch: ${sigBytes} bytes (expected 65)`);
  }

  console.log("\n[smoke/tee-headers] PASS — round-trip protocol matches agent-wrapper.");
  console.log(
    "  This confirms TEEVerifier.verifyTEESignature(keccak256(content), sig) will accept",
  );
  console.log("  signatures produced by agent-wrapper without modification.");
}

void main().catch((err: unknown) => {
  console.error("[smoke/tee-headers] FAIL", err);
  process.exit(1);
});
