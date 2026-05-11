/**
 * explorer.ts — single source of truth for Galileo explorer URLs.
 *
 * 0G runs `https://chainscan-galileo.0g.ai` (Etherscan-clone) for the
 * Galileo testnet. Every clickable identifier in the dashboard
 * routes through one of these helpers so:
 *
 *   1. There's exactly ONE place to change if 0G renames the host
 *      (mainnet uses `https://chainscan.0g.ai`, same shape).
 *   2. We never hardcode the AgenticID address into a URL string —
 *      it pulls from the env constants, so a self-host overriding
 *      AGENTICID_ADDRESS gets correct links automatically.
 *   3. Linking conventions are consistent: addresses always go to
 *      `/address`, tokens always go to `/token/<contract>?a=<id>`,
 *      txs always go to `/tx`.
 */

import { loadEnv } from "./env.js";

const TESTNET_BASE = "https://chainscan-galileo.0g.ai";
const MAINNET_BASE = "https://chainscan.0g.ai";
const STORAGE_TESTNET = "https://indexer-storage-testnet-turbo.0g.ai";
const STORAGE_MAINNET = "https://indexer-storage-turbo.0g.ai";
const GALILEO_CHAIN_ID = 16602;

/** Pick the right explorer base for the configured chain. */
function explorerBase(): string {
  const env = loadEnv();
  return env.CHAIN_ID === GALILEO_CHAIN_ID ? TESTNET_BASE : MAINNET_BASE;
}

function storageBase(): string {
  const env = loadEnv();
  return env.CHAIN_ID === GALILEO_CHAIN_ID ? STORAGE_TESTNET : STORAGE_MAINNET;
}

/** EOA or contract address page. */
export function addressUrl(address: string): string {
  return `${explorerBase()}/address/${address}`;
}

/** Transaction page. */
export function txUrl(txHash: string): string {
  return `${explorerBase()}/tx/${txHash}`;
}

/** Block page. */
export function blockUrl(blockNumber: number | bigint | string): string {
  return `${explorerBase()}/block/${blockNumber.toString()}`;
}

/**
 * AgenticID iNFT page — pre-deployed contract address from env, with
 * ?a=<tokenId> query param (Etherscan convention for token-id detail).
 */
export function agenticIdTokenUrl(tokenId: string | number | bigint): string {
  const env = loadEnv();
  return `${explorerBase()}/token/${env.AGENTICID_ADDRESS}?a=${tokenId.toString()}`;
}

/** AgenticID contract page (no token filter). */
export function agenticIdContractUrl(): string {
  const env = loadEnv();
  return `${explorerBase()}/token/${env.AGENTICID_ADDRESS}`;
}

/** MockTEEVerifier contract page. */
export function teeVerifierContractUrl(): string {
  const env = loadEnv();
  return `${explorerBase()}/address/${env.TEE_VERIFIER_ADDRESS}`;
}

/**
 * 0G Storage blob URL. Resolves to the indexer's `/file?root=<rootHash>`
 * endpoint which serves the raw blob — useful for a "Download proof"
 * link on the session detail page.
 */
export function storageBlobUrl(rootHash: string): string {
  return `${storageBase().replace(/\/$/, "")}/file?root=${rootHash}`;
}

/** Faucet for the configured chain (only meaningful on testnet). */
export function faucetUrl(): string {
  return "https://faucet.0g.ai";
}
