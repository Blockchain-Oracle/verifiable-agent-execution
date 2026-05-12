/**
 * share-command.ts — /share slash command for on-demand share-link delivery.
 *
 * Why this exists (Abu's UX critique, 2026-05-12):
 *   Auto-injecting the share URL into every agent reply is FRICTION.
 *   Users running an AI agent normally don't want their conversation
 *   polluted with a verifier link every turn — 99% of the time they
 *   never share. The right product UX is: silent by default; the
 *   user types `/share` (or `/share <tokenId>`) when they actually
 *   want to share THIS receipt with somebody.
 *
 * OpenClaw plumbing:
 *   - `api.registerCommand({name: "share", ...})` declares the
 *     command. Channel providers (Telegram bot menu, Discord slash
 *     commands, CLI tab-complete) pick it up automatically — the user
 *     sees `/share` in their command picker without any per-channel
 *     setup.
 *   - `api.on("inbound_claim", handler)` fires when an inbound
 *     message matches our registered command. The handler returns
 *     `{handled: true, reply: {text: "..."}}` to short-circuit the
 *     agent and send a custom reply.
 *   - Reference impl: stock `codex` plugin at
 *     /tmp/openclaw-src/extensions/codex/index.ts:32-38 uses exactly
 *     this pattern.
 */

import { keyToShareString } from "./crypto.js";
import type { Keystore } from "./keystore.js";

/**
 * Reply payload shape OpenClaw expects from inbound_claim handlers.
 * Subset of the SDK's full ReplyPayload — only `text` is required for
 * a custom reply, the rest is delivery routing the runtime fills in.
 */
export interface ShareCommandReplyPayload {
  text: string;
}

export interface ShareCommandResult {
  handled: boolean;
  reply?: ShareCommandReplyPayload;
}

export interface ShareCommandContext {
  keystore: Keystore;
  verifyUrlBase: string;
}

export interface ShareCommandEvent {
  /** The full inbound message body (may include `/share` prefix or args). */
  content?: unknown;
  /** OpenClaw sets this when the inbound matched a registered command. */
  commandAuthorized?: unknown;
  /** Args after the command — channels may already split for us. */
  args?: unknown;
}

/**
 * Handle a /share inbound. Parses optional tokenId arg; looks up the
 * key in the keystore; builds the share URL and replies with it.
 *
 * Returns `{handled: false}` to let the agent process the message
 * normally if we can't satisfy the command (e.g., no receipts yet).
 * `{handled: true}` short-circuits the agent.
 */
export function handleShareCommand(
  ctx: ShareCommandContext,
  event: ShareCommandEvent,
): ShareCommandResult {
  // Parse the optional tokenId arg. Three sources, in priority:
  //   1. event.args[0] if the channel pre-split arguments
  //   2. event.content text after the `/share` prefix
  //   3. fall back to the most-recent receipt in the keystore
  const requestedTokenId = parseTokenIdArg(event);

  let tokenId: string | null;
  let sessionKey: string | null;
  if (requestedTokenId !== null) {
    tokenId = requestedTokenId;
    sessionKey = null;
  } else {
    const last = ctx.keystore.getLast();
    if (last === null) {
      return {
        handled: true,
        reply: {
          text:
            "📭 No receipts yet on this host. Run an agent action first; " +
            "the next `/share` will return the URL for that receipt.",
        },
      };
    }
    tokenId = last.tokenId;
    sessionKey = last.sessionKey;
  }

  const key = ctx.keystore.get(tokenId);
  if (key === null) {
    return {
      handled: true,
      reply: {
        text:
          `🔒 No key on this host for tokenId ${tokenId}. ` +
          "Either the receipt was minted on a different host, or the keystore " +
          "was wiped. Receipts minted elsewhere need their share-link from the " +
          "host that ran the agent.",
      },
    };
  }

  const baseUrl = `${ctx.verifyUrlBase.replace(/\/$/, "")}/verify/${tokenId}`;
  const shareUrl = `${baseUrl}#k=${keyToShareString(key)}`;
  const sessionFootnote =
    sessionKey !== null ? `\n\n_Session: \`${sessionKey}\`_` : "";
  return {
    handled: true,
    reply: {
      text:
        `📎 Verifiable receipt for tokenId ${tokenId}:\n\n${shareUrl}\n\n` +
        "Anyone with this link can verify the proof chain (hash + signature + " +
        "chain anchor) AND see the decoded entries. Without the link's " +
        "`#k=...` fragment, visitors only see metadata — your conversation " +
        "stays private." +
        sessionFootnote,
    },
  };
}

/**
 * Pull a tokenId out of `event.args` or `event.content`. Returns null
 * for the no-args case (caller falls back to getLast()).
 *
 * Accepts:
 *   - bare numeric: `/share 7` → "7"
 *   - explicit "last" keyword: `/share last` → null (use last)
 *   - empty content: null (use last)
 *
 * NOTE (Codex round-9, partial accept): handleShareCommand reads
 * `event.args[0]` when present — that path was added for Discord-style
 * channels that pre-split slash-command args. The registered
 * `inbound_claim` handler in src/index.ts gates entry on
 * `content.startsWith("/share")` to prevent OTHER authorized commands
 * (e.g. `/upload`) from accidentally routing here. Channels that
 * dispatch authorized /share events without raw content must also
 * pass `content: "/share"` for the v0.3.0 cycle — making the gate
 * "command-name-aware" would require a `command` field on the
 * inbound event that OpenClaw 2026.4.x doesn't surface. Tracked
 * for v0.4.0.
 */
function parseTokenIdArg(event: ShareCommandEvent): string | null {
  // 1. structured args (channel pre-split — Discord slash command etc.)
  if (Array.isArray(event.args) && event.args.length > 0) {
    const first = event.args[0];
    if (typeof first === "string") {
      const trimmed = first.trim();
      if (trimmed.length > 0 && trimmed.toLowerCase() !== "last") {
        return trimmed;
      }
    }
  }
  // 2. parse content text — strip "/share" prefix, take the next token.
  if (typeof event.content === "string") {
    // Match `/share <arg>` with optional whitespace; case-insensitive
    // on the command itself.
    const match = event.content.match(/^\s*\/share\s+(\S+)/i);
    if (match !== null) {
      const arg = match[1]!.trim();
      if (arg.length > 0 && arg.toLowerCase() !== "last") {
        return arg;
      }
    }
  }
  return null;
}
