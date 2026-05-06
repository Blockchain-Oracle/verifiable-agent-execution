/**
 * Types for the chain-client package.
 *
 * `IntelligentData` mirrors the Solidity struct from the deployed
 * AgenticID contract at 0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F on
 * Galileo (16602):
 *
 *   struct IntelligentData {
 *     string dataDescription;
 *     bytes32 dataHash;
 *   }
 *
 * Source of truth: agenticID-examples/01-mint-and-manage/contracts/
 *   interfaces/IERC7857.sol (verified by on-chain reads in
 *   scripts/smoke/agenticid.ts and context/SOURCE_OF_TRUTH.md).
 */

import { z } from "zod";

const BYTES32_HEX_RE = /^0x[0-9a-fA-F]{64}$/u;
const ADDRESS_HEX_RE = /^0x[0-9a-fA-F]{40}$/u;

export interface IntelligentData {
  /** Human-readable description; e.g. "exec-log:<sessionId>:<modelId>" per ADR-08. */
  dataDescription: string;
  /** keccak256/sha256 anchor hash, 32 bytes. */
  dataHash: string;
}

export const intelligentDataSchema = z.object({
  dataDescription: z.string().min(1),
  dataHash: z.string().regex(BYTES32_HEX_RE),
});

export const addressSchema = z.string().regex(ADDRESS_HEX_RE);
export const bytes32Schema = z.string().regex(BYTES32_HEX_RE);

export interface MintResult {
  /** ERC-721 tokenId returned by the mint tx. */
  tokenId: bigint;
  /** Transaction hash of the mint. */
  txHash: string;
}
