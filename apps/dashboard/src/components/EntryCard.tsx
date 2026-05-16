"use client";

/**
 * EntryCard — one tool call, decoded. Court-exhibit aesthetic:
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  #001  quote                                  [BADGE]  │
 *   │  ─────────────────────────────────────────────────     │
 *   │  Input ↓                                               │
 *   │    { from: "USDC", to: "ETH", amount: 1000 }           │
 *   │  Output ↓                                              │
 *   │    { rate: 2380.42, ethOut: 0.42 }                     │
 *   │  inputHash  · 2eb1…f7c1                                │
 *   │  outputHash · 9a44…d201                                │
 *   │  TEE sig    · 0x1c…afef  (signed at 14:32:15)          │
 *   └────────────────────────────────────────────────────────┘
 *
 * The badge has THREE states driven by a per-entry verify call:
 *   - "pending" (initial)  → grey outline, no fill
 *   - "verifying"          → grey outline + pulse
 *   - "verified" / "unverified" / "unsigned" → final color
 *
 * The verifyOnClick prop fires the per-entry verify when called,
 * driving the sequential badge-flip animation that's the PRD's hero
 * moment.
 */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighterBase } from "react-syntax-highlighter";
import type { SyntaxHighlighterProps } from "react-syntax-highlighter";

// Cast needed: @types/react-syntax-highlighter lags React 18's `refs` field.
const SyntaxHighlighter = SyntaxHighlighterBase as unknown as (
  props: SyntaxHighlighterProps & { children: string }
) => React.ReactElement;

import { Mono } from "./Mono";

// Dashboard-palette Prism theme — matches bg-surface + brand accent colors
const agentscanTheme: Record<string, React.CSSProperties> = {
  'code[class*="language-"]': { color: "#9AA8B5", background: "none", fontSize: "0.75rem", fontFamily: "var(--font-mono, monospace)" },
  'pre[class*="language-"]': { color: "#9AA8B5", background: "#0B0F14", margin: 0, padding: "0.75rem 1rem", borderRadius: "0.375rem", overflowX: "hidden", whiteSpace: "pre-wrap", wordBreak: "break-all" },
  "property": { color: "#36D399" },
  "string": { color: "#F3F7FA" },
  "number": { color: "#F5B84B" },
  "boolean": { color: "#57B8FF" },
  "null": { color: "#FF5A6A" },
  "punctuation": { color: "#263241" },
  "comment": { color: "#64748B", fontStyle: "italic" },
  "keyword": { color: "#36D399" },
  "operator": { color: "#9AA8B5" },
};

const markdownComponents: Components = {
  a: ({ href, children, node: _node, ...props }) => (
    <a href={href} target="_blank" rel="noreferrer" {...props}>
      {children}
    </a>
  ),
};

export type EntryStatus =
  | { state: "pending" }
  | { state: "verifying" }
  | { state: "verified" }
  | { state: "unverified"; reason?: string }
  | { state: "error"; reason?: string }
  | { state: "unsigned" };

interface EntryProps {
  seq: number;
  ts: number;
  type: string;
  tool?: string;
  inputHash: string;
  outputHash: string;
  hasTeeSignature: boolean;
  params?: unknown;
  result?: unknown;
  status: EntryStatus;
}

/**
 * Friendly-title + label mapping for the synthetic plugin entry
 * "tools" (user_input, prompt_build, llm_call) — these aren't real
 * tools the agent invoked, they're plugin-injected entries that
 * capture what the agent runtime DID (received a message, built a
 * prompt, got an LLM response). Rendering them as "tool_call /
 * user_input" is misleading; rendering as "User message" with
 * sensible input/output labels makes the receipt read like a
 * timeline an auditor can follow.
 *
 * Real tools (web_search, fetch_url, MCP tools) fall through to
 * the default branch and render as "Tool: web_search" etc.
 *
 * Skill invocations: when a Read tool targets a SKILL.md path
 * (e.g. /skills/agentmail/SKILL.md), the OpenClaw SDK surfaces it
 * as an after_tool_call event — we detect and relabel it here so
 * auditors see "Skill: agentmail" rather than an opaque "Tool: Read".
 */
function entryDisplay(props: EntryProps): {
  title: string;
  subtitle: string | null;
  inputLabel: string;
  outputLabel: string;
  kind?: "skill";
} {
  const tool = props.tool ?? props.type;

  // Detect skill invocations: Read on any /skills/<name>/SKILL.md path
  if (tool === "Read" || tool === "read") {
    const p = props.params;
    const filePath =
      typeof p === "object" && p !== null
        ? (p as Record<string, unknown>).file_path
        : undefined;
    if (typeof filePath === "string") {
      const m = filePath.match(/\/skills\/([^/]+)\/SKILL\.md$/i);
      if (m) {
        const skillName = m[1] ?? "unknown";
        return {
          title: `Skill: ${skillName}`,
          subtitle: "skill loaded",
          inputLabel: "Skill file",
          outputLabel: "Skill content",
          kind: "skill",
        };
      }
    }
  }

  switch (tool) {
    case "user_input":
      return {
        title: "User message",
        subtitle: "inbound",
        inputLabel: "Sender",
        outputLabel: "Message",
      };
    case "prompt_build":
      return {
        title: "Prompt assembled",
        subtitle: "agent to LLM",
        inputLabel: "Session ref",
        outputLabel: "Prompt + system + history",
      };
    case "llm_call":
    case "llm_text":
      return {
        title: "LLM response",
        subtitle: "LLM to agent",
        inputLabel: "Run context",
        outputLabel: "Response content",
      };
    case "session_end":
      return {
        title: "Session end",
        subtitle: "lifecycle",
        inputLabel: "Trigger",
        outputLabel: "Summary",
      };
    case "agent_end":
      return {
        title: "Agent end",
        subtitle: "lifecycle",
        inputLabel: "Trigger",
        outputLabel: "Summary",
      };
    default:
      return {
        title: `Tool: ${tool}`,
        subtitle: "agent to tool",
        inputLabel: "Params",
        outputLabel: "Result",
      };
  }
}

export function EntryCard(props: EntryProps) {
  const [paramsOpen, setParamsOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const display = entryDisplay(props);

  return (
    <article className="group min-w-0 overflow-hidden rounded-md border border-border/80 bg-surface/95 shadow-[0_16px_44px_rgba(0,0,0,0.2)] transition-colors hover:border-accent-link/35">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/70 px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-baseline gap-3 sm:gap-4">
          <span className="font-mono text-[11px] tabular-nums text-text-secondary">
            #{props.seq.toString().padStart(3, "0")}
          </span>
          <span className="truncate font-sans text-base font-semibold text-text-primary">
            {display.title}
          </span>
          {display.subtitle !== null && (
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary sm:inline">
              {display.subtitle}
            </span>
          )}
          {display.kind === "skill" && (
            <span className="hidden items-center gap-1 rounded border border-accent-verify/40 bg-accent-verify/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent-verify sm:inline-flex">
              Skill
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <time
            dateTime={new Date(props.ts).toISOString()}
            className="font-mono text-[11px] tabular-nums text-text-secondary"
          >
            {formatTime(props.ts)}
          </time>
          <EntryBadge status={props.status} />
        </div>
      </header>

      <div className="min-w-0 space-y-4 px-4 py-4 sm:px-5">
        <ContentBlock
          label={display.inputLabel}
          value={props.params}
          fallbackHash={props.inputHash}
          open={paramsOpen}
          onToggle={() => setParamsOpen((v) => !v)}
        />
        <ContentBlock
          label={display.outputLabel}
          value={props.result}
          fallbackHash={props.outputHash}
          open={resultOpen}
          onToggle={() => setResultOpen((v) => !v)}
        />
      </div>

      <footer className="grid grid-cols-1 gap-y-1 border-t border-border/60 bg-bg/55 px-4 py-3 font-mono text-[11px] text-text-secondary sm:px-5 md:grid-cols-2 md:gap-x-8">
        <div className="flex justify-between gap-4">
          <span className="uppercase tracking-wider">inputHash</span>
          <Mono truncate={20} copy>
            {props.inputHash}
          </Mono>
        </div>
        <div className="flex justify-between gap-4">
          <span className="uppercase tracking-wider">outputHash</span>
          <Mono truncate={20} copy>
            {props.outputHash}
          </Mono>
        </div>
        <div className="flex justify-between gap-4 md:col-span-2">
          <span className="uppercase tracking-wider">TEE signature</span>
          <span className="text-text-primary">
            {props.hasTeeSignature ? "present" : "—"}
          </span>
        </div>
      </footer>
    </article>
  );
}

/**
 * Detect whether a string value SHOULD be rendered as markdown.
 *
 * Tool results from WebSearch/WebFetch/Read often come back as
 * markdown (Claude Code's tool-result encoding). Rendering them in a
 * plain `<pre>` produces an unreadable wall of `*` and `#` characters,
 * AND triggers a horizontal scrollbar when URLs / long paths wrap
 * past the viewport — the exact issue Abu called out 2026-05-15
 * ("i had to scroll horizonally to the left which dosent make sense").
 *
 * We keep this conservative: only opt into markdown rendering if the
 * string actually has a structural markdown signal (header line,
 * fenced code block, link/image syntax, list bullets). Plain prose
 * still renders as plain text. JSON-like content (starts with `{` or
 * `[`) stays in the monospace `<pre>` because JSON looks weird under
 * a markdown renderer.
 */
function looksLikeMarkdown(s: string): boolean {
  // Reject things that obviously aren't markdown documents.
  const trimmed = s.trimStart();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  // Strong signals: ATX headers, fenced code, links/images, bulleted
  // list items, numbered lists, bold spans, blockquotes, markdown
  // tables. Any one is sufficient. The bold-only path matters for
  // decrypted agent answers where the model returns prose with
  // `**section labels**` but no heading.
  return (
    /^#{1,6}\s/m.test(s) ||
    /```/.test(s) ||
    /\[[^\]]+\]\([^)]+\)/.test(s) ||
    /^\s{0,3}[-*+]\s/m.test(s) ||
    /^\s{0,3}\d+\.\s/m.test(s) ||
    /^\s{0,3}>\s/m.test(s) ||
    /(\*\*|__)(?=\S)([\s\S]*?\S)\1/.test(s) ||
    /^\|.+\|.+\|/m.test(s)
  );
}

type DisplayContent =
  | { kind: "markdown"; value: string }
  | { kind: "code"; value: string; language: "bash" | "json" };

function resolveDisplayContent(value: unknown): DisplayContent | null {
  if (value === undefined || value === null) return null;
  const markdown = extractMarkdownCandidate(value);
  if (markdown !== null) {
    return { kind: "markdown", value: markdown };
  }
  return {
    kind: "code",
    value: typeof value === "string" ? value : safeStringify(value),
    language: typeof value === "object" ? "json" : "bash",
  };
}

function extractMarkdownCandidate(value: unknown): string | null {
  if (typeof value === "string") {
    return looksLikeMarkdown(value) ? value : null;
  }
  if (Array.isArray(value)) {
    const textBlocks = value.flatMap((item) => extractTextBlocks(item));
    const joined = textBlocks.join("\n\n").trim();
    return joined.length > 0 && looksLikeMarkdown(joined) ? joined : null;
  }
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  const preferredKeys = [
    "markdown",
    "content",
    "text",
    "result",
    "output",
    "message",
    "answer",
    "body",
  ];

  for (const key of preferredKeys) {
    if (!(key in record)) continue;
    const direct = extractMarkdownCandidate(record[key]);
    if (direct !== null) return direct;
  }

  return null;
}

function extractTextBlocks(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => extractTextBlocks(item));
  if (typeof value !== "object" || value === null) return [];

  const record = value as Record<string, unknown>;
  const text = record.text;
  if (typeof text === "string") return [text];
  const content = record.content;
  if (typeof content === "string") return [content];
  if (Array.isArray(content)) return content.flatMap((item) => extractTextBlocks(item));
  return [];
}

export function ContentBlock({
  label,
  value,
  fallbackHash,
  open,
  onToggle,
}: {
  label: string;
  value: unknown;
  fallbackHash: string;
  open: boolean;
  onToggle: () => void;
}) {
  const isPresent = value !== undefined && value !== null;
  const content = resolveDisplayContent(value);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:text-text-primary"
      >
        <span className="flex items-center gap-2">
          <Caret open={open} />
          {label}
          {!isPresent && (
            <span className="font-sans text-[10px] normal-case tracking-normal text-text-secondary">
              (redacted, sha256 only)
            </span>
          )}
        </span>
      </button>
      {open && content?.kind === "markdown" && (
        <div className="markdown-body mt-2 break-words rounded-md border border-border/50 bg-bg/75 px-4 py-3 text-sm leading-relaxed text-text-primary">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {content.value}
          </ReactMarkdown>
        </div>
      )}
      {open && content?.kind === "code" && (
        <div className="mt-2 overflow-hidden rounded-md border border-border/50">
          <SyntaxHighlighter
            language={content.language}
            style={agentscanTheme}
            wrapLines
            wrapLongLines
          >
            {content.value}
          </SyntaxHighlighter>
        </div>
      )}
      {open && !isPresent && (
        <pre className="mt-2 rounded border border-border/40 bg-bg px-4 py-3 font-mono text-xs text-text-secondary">
          sha256: {fallbackHash}
        </pre>
      )}
    </div>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function EntryBadge({ status }: { status: EntryStatus }) {
  switch (status.state) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary">
          <span className="h-1 w-1 rounded-full bg-text-secondary/60" />
          Awaiting verify
        </span>
      );
    case "verifying":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-text-secondary/40 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary">
          <span className="relative flex h-1 w-1">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-text-secondary opacity-75" />
            <span className="relative inline-flex h-1 w-1 rounded-full bg-text-secondary" />
          </span>
          Verifying…
        </span>
      );
    case "verified":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-verify/40 bg-accent-verify/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent-verify drop-shadow-[0_0_4px_rgba(16,185,129,0.4)]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            className="h-2.5 w-2.5"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          TEE Verified
        </span>
      );
    case "unverified":
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-accent-unverified/40 bg-accent-unverified/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent-unverified"
          title={status.reason}
        >
          <BadgeIcon path="M6 18 18 6M6 6l12 12" />
          Unverified
        </span>
      );
    case "error":
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-accent-mock/40 bg-accent-mock/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent-mock"
          title={status.reason ?? "Verifier unreachable"}
        >
          <BadgeIcon path="M12 8v4m0 4h.01M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 21h15.8a2 2 0 0 0 1.7-3.4L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          RPC error
        </span>
      );
    case "unsigned":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-mock/40 bg-accent-mock/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent-mock">
          Unsigned
        </span>
      );
  }
}

function BadgeIcon({ path }: { path: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-2.5 w-2.5"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
