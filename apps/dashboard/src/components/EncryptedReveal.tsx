"use client";

/**
 * EncryptedReveal — client-side wrapper for v0.3.0 "encrypted" receipts.
 *
 * When the server-side `resolveProof` returns `verified: "encrypted"`,
 * the blob on 0G Storage is an AES-256-GCM envelope and no reveal key
 * was sent server-side. This component:
 *
 *   1. Renders the metadata-only "🔒 Encrypted" state immediately
 *   2. On mount, reads `window.location.hash` for `#k=<base64url-key>`
 *   3. If found, re-fetches `/api/verify/[tokenId]?k=<key>` and
 *      hydrates the full SessionView with decrypted entries
 *   4. If absent, leaves the locked-state UI for the visitor to either
 *      paste a key or close the tab
 *
 * The URL fragment NEVER hits the server (browsers don't include it in
 * HTTP requests). The page-level server component only sees the path
 * + query string. We forward the key via `?k=` ONLY after the client
 * reads the hash — that round-trip keeps the fragment cookie-style
 * private to the visitor's browser.
 */

import { useEffect, useState } from "react";

import { Mono } from "@/components/Mono";
import { SessionView } from "@/components/SessionView";
import { StatusBadge } from "@/components/StatusBadge";
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

export function EncryptedReveal({ initialProof }: EncryptedRevealProps) {
  const [state, setState] = useState<RevealState>({ status: "locked" });

  useEffect(() => {
    // window.location.hash includes the leading '#' — strip it before
    // parsing. The conventional share-link format is "#k=<base64url>".
    const hash = window.location.hash.replace(/^#/, "");
    if (hash.length === 0) return;
    const params = new URLSearchParams(hash);
    const key = params.get("k");
    if (key === null || key.length === 0) return;

    setState({ status: "decrypting" });
    const controller = new AbortController();
    fetch(`/api/verify/${initialProof.tokenId}?k=${encodeURIComponent(key)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: { code?: string; message?: string } }
            | null;
          const msg =
            body?.error?.message ?? `${res.status} ${res.statusText}`;
          throw new Error(msg);
        }
        return res.json() as Promise<ProofResponse>;
      })
      .then((proof) => {
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
  }, [initialProof.tokenId]);

  if (state.status === "decrypted") {
    return <SessionView proof={state.proof} />;
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
                that decrypts in your browser without ever being sent to
                a server. Once you have the URL, the entries appear below
                automatically.
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
