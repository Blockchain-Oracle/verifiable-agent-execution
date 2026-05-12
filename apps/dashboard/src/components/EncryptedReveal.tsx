"use client";

/**
 * EncryptedReveal — fully client-side reveal for v0.3.0 encrypted receipts.
 *
 * Server returns metadata with `verified === "encrypted"` and no entries.
 * This component:
 *
 *   1. Renders the metadata-only "🔒 Encrypted" state immediately
 *   2. On mount, reads `window.location.hash` for `#k=<base64url-key>`
 *   3. If found, fetches the **encrypted envelope** from
 *      `/api/verify/[tokenId]/blob` (a key-blind passthrough — the
 *      server never sees `?k=`), decrypts in the browser using
 *      `apps/dashboard/src/lib/crypto.ts`, and hands SessionView the
 *      synthesized full proof + a client-side `verifyEntry` callback.
 *   4. If absent, leaves the locked-state UI for the visitor to either
 *      paste a key or close the tab.
 *
 * v0.3.0 SECURITY: the reveal key NEVER leaves the browser. Not via
 * URL query, not via request body, not via header. Browsers never
 * include the fragment in any request — that's the whole point of
 * using a fragment for the reveal key. Server logs, reverse proxies,
 * and APM traces are all key-blind by construction.
 */

import { useEffect, useState } from "react";

import { Mono } from "@/components/Mono";
import { SessionView } from "@/components/SessionView";
import { StatusBadge } from "@/components/StatusBadge";
import {
  decryptSessionLog,
  isEncryptedEnvelope,
  shareStringToKey,
} from "@/lib/crypto";
import { verifyEntryClient } from "@/lib/client-verify";
import { type ProofResponse } from "@/lib/verify-proof";

interface EncryptedRevealProps {
  /** The metadata-only proof from the server-side fetch. */
  initialProof: ProofResponse;
}

type RevealState =
  | { status: "locked" }
  | { status: "decrypting" }
  | { status: "decrypted"; proof: ProofResponse }
  | { status: "error"; message: string };

interface SessionLogEntryShape {
  seq: number;
  ts: number;
  type: string;
  tool?: string;
  inputHash: string;
  outputHash: string;
  teeSignature?: string;
  agentId?: string;
  sealId?: string;
  signedAt?: number;
  params?: unknown;
  result?: unknown;
  redacted?: boolean;
}

interface DecodedSessionLog {
  sessionId: string;
  entryCount: number;
  entries: SessionLogEntryShape[];
}

export function EncryptedReveal({ initialProof }: EncryptedRevealProps) {
  const [state, setState] = useState<RevealState>({ status: "locked" });

  useEffect(() => {
    // window.location.hash includes the leading '#' — strip it before
    // parsing. The conventional share-link format is "#k=<base64url>".
    const hash = window.location.hash.replace(/^#/, "");
    if (hash.length === 0) return;
    const params = new URLSearchParams(hash);
    const keyStr = params.get("k");
    if (keyStr === null || keyStr.length === 0) return;

    setState({ status: "decrypting" });
    const controller = new AbortController();
    // Fetch the encrypted envelope from the key-blind passthrough.
    // We deliberately do NOT include the key in this request — the
    // envelope is public bytes (without the key it's unreadable).
    fetch(`/api/verify/${initialProof.tokenId}/blob`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: { code?: string; message?: string } }
            | null;
          throw new Error(body?.error?.message ?? `${res.status} ${res.statusText}`);
        }
        return res.json() as Promise<unknown>;
      })
      .then((envelope) => {
        if (!isEncryptedEnvelope(envelope)) {
          throw new Error("Server returned non-envelope payload.");
        }
        // Decrypt in the browser. shareStringToKey throws on malformed
        // input; decryptSessionLog throws on AES-GCM auth-tag mismatch.
        const key = shareStringToKey(keyStr);
        const plaintextJson = decryptSessionLog(envelope, key);
        const decoded = JSON.parse(plaintextJson) as DecodedSessionLog;
        if (
          typeof decoded !== "object" ||
          decoded === null ||
          !Array.isArray(decoded.entries)
        ) {
          throw new Error("Decrypted payload missing entries array.");
        }
        // Synthesize a ProofResponse so SessionView can render. We
        // keep the server-provided metadata (rootHash, explorer URLs,
        // rpcUrl, verifierAddress) and only fill in the entries +
        // verified status from the locally-decrypted log.
        const proof: ProofResponse = {
          ...initialProof,
          sessionId: decoded.sessionId,
          entryCount: decoded.entryCount,
          // verified is provisional on the client — SessionView's
          // verifyEntry callback runs the cascade and the badges
          // resolve to verified | unverified | unsigned per-entry.
          verified: "preview",
          entries: decoded.entries.map((e) => ({
            seq: e.seq,
            ts: e.ts,
            type: e.type,
            tool: e.tool,
            inputHash: e.inputHash,
            outputHash: e.outputHash,
            hasTeeSignature: e.teeSignature !== undefined,
            ...(e.teeSignature !== undefined ? { teeSignature: e.teeSignature } : {}),
            ...(e.agentId !== undefined ? { agentId: e.agentId } : {}),
            ...(e.sealId !== undefined ? { sealId: e.sealId } : {}),
            ...(e.signedAt !== undefined ? { signedAt: e.signedAt } : {}),
            ...(e.params !== undefined ? { params: e.params } : {}),
            ...(e.result !== undefined ? { result: e.result } : {}),
            ...(e.redacted === true ? { redacted: true } : {}),
          })),
        };
        setState({ status: "decrypted", proof });
      })
      .catch((cause: unknown) => {
        if ((cause as { name?: string }).name === "AbortError") return;
        setState({
          status: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });

    return () => controller.abort();
  }, [initialProof]);

  if (state.status === "decrypted") {
    // Pass a client-side verifyEntry — encrypted-mode SessionView
    // verifies each entry in the browser via ethers, NOT via
    // /api/verify/<id>/entry/<seq> (which is key-blind and can't
    // decrypt the entry).
    return (
      <SessionView
        proof={state.proof}
        verifyEntry={(entry) =>
          verifyEntryClient(entry, {
            rpcUrl: state.proof.meta.rpcUrl,
            verifierAddress: state.proof.meta.verifierAddress,
          })
        }
      />
    );
  }

  // Locked / decrypting / error all share the metadata-only chrome.
  // Only the small status pill + footer hint differ.
  return (
    <section className="mx-auto max-w-5xl px-6 py-10">
      <div className="rounded-md border border-border bg-surface p-8">
        <header className="flex items-baseline justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary">
              Token #{initialProof.tokenId}
            </p>
            <h1 className="mt-2 font-sans text-2xl font-semibold text-text-primary">
              Verifiable Agent Receipt
            </h1>
          </div>
          <StatusBadge status="encrypted" />
        </header>

        <p className="mt-6 max-w-prose font-sans text-sm leading-relaxed text-text-secondary">
          This receipt&apos;s contents are encrypted off-chain. The proof
          chain (hash, signature, mint transaction) is verifiable cold by
          anyone visiting this URL — but to see WHAT the agent did, the
          owner must share a reveal link with you.
        </p>

        <dl className="mt-8 grid grid-cols-[200px_1fr] gap-y-3 font-mono text-xs">
          <dt className="uppercase tracking-wider text-text-secondary">Token ID</dt>
          <dd>
            <Mono>{initialProof.tokenId}</Mono>
          </dd>
          <dt className="uppercase tracking-wider text-text-secondary">Session ID</dt>
          <dd className="break-all">
            <Mono>{initialProof.sessionId}</Mono>
          </dd>
          <dt className="uppercase tracking-wider text-text-secondary">Root Hash</dt>
          <dd className="break-all">
            <Mono>{initialProof.rootHash}</Mono>
          </dd>
          <dt className="uppercase tracking-wider text-text-secondary">
            On-Chain Anchor
          </dt>
          <dd>
            <a
              className="text-accent-link hover:underline"
              href={initialProof.meta.explorer.token}
              target="_blank"
              rel="noopener noreferrer"
            >
              View iNFT on chainscan ↗
            </a>
          </dd>
          <dt className="uppercase tracking-wider text-text-secondary">
            Storage Blob
          </dt>
          <dd>
            <a
              className="text-accent-link hover:underline"
              href={initialProof.meta.storageUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View encrypted bytes on 0G Storage ↗
            </a>
          </dd>
        </dl>

        <div className="mt-8 rounded-md border border-border/60 bg-bg/40 p-4 font-sans text-sm leading-relaxed text-text-secondary">
          {state.status === "locked" && (
            <>
              <p className="text-text-primary">🔒 No reveal key provided</p>
              <p className="mt-2">
                Ask the receipt&apos;s owner to share the full URL — it
                includes a fragment like{" "}
                <code className="font-mono text-xs text-text-primary">
                  #k=…
                </code>{" "}
                that your browser uses to decrypt locally. The key never
                leaves your machine — not via this dashboard, not via
                any server log. Once you have the URL, the entries
                appear below automatically.
              </p>
            </>
          )}
          {state.status === "decrypting" && (
            <p className="text-text-primary">
              🔓 Decrypting receipt locally…
            </p>
          )}
          {state.status === "error" && (
            <>
              <p className="text-accent-unverified">
                ⚠ Decryption failed
              </p>
              <p className="mt-2">{state.message}</p>
              <p className="mt-2 text-text-secondary">
                Check that the URL fragment is complete and the key
                hasn&apos;t been corrupted by an over-eager link previewer.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
