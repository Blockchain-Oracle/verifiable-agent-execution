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
  'code[class*="language-"]': { color: "#A3A6B1", background: "none", fontSize: "0.75rem", fontFamily: "var(--font-mono, monospace)" },
  'pre[class*="language-"]': { color: "#A3A6B1", background: "#15171A", margin: 0, padding: "0.75rem 1rem", borderRadius: "0.25rem", overflowX: "hidden", whiteSpace: "pre-wrap", wordBreak: "break-all" },
  "property": { color: "#10B981" },        // keys — accent-verify green
  "string": { color: "#F5F5F5" },          // string values — text-primary
  "number": { color: "#F59E0B" },          // numbers — accent-mock amber
  "boolean": { color: "#3B82F6" },         // booleans — link blue
  "null": { color: "#EF4444" },            // null — accent-unverified red
  "punctuation": { color: "#363A45" },     // brackets/commas — border color
  "comment": { color: "#4B5563", fontStyle: "italic" },
  "keyword": { color: "#10B981" },
  "operator": { color: "#A3A6B1" },
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
        subtitle: "agent → LLM",
        inputLabel: "Session ref",
        outputLabel: "Prompt + system + history",
      };
    case "llm_call":
    case "llm_text":
      return {
        title: "LLM response",
        subtitle: "LLM → agent",
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
        subtitle: "agent → tool",
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
    <article className="group min-w-0 overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-border/80">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 px-4 py-3 sm:px-5">
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
              ✦ skill
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

      <footer className="grid grid-cols-1 gap-y-1 border-t border-border/60 bg-bg/40 px-4 py-3 font-mono text-[11px] text-text-secondary sm:px-5 md:grid-cols-2 md:gap-x-8">
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
  // list items, markdown tables. Any one is sufficient.
  return (
    /^#{1,6}\s/m.test(s) ||
    /```/.test(s) ||
    /\[[^\]]+\]\([^)]+\)/.test(s) ||
    /^\s{0,3}[-*+]\s/m.test(s) ||
    /^\|.+\|.+\|/m.test(s)
  );
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
  const stringValue = isPresent
    ? typeof value === "string"
      ? value
      : safeStringify(value)
    : null;
  // Markdown-render only when the value is a STRING (not stringified
  // JSON) AND has structural markdown signals. Otherwise fall back to
  // the existing monospace presentation. The conservative gate keeps
  // hash strings / JSON / plain prose rendering correctly.
  const renderAsMarkdown =
    typeof value === "string" && looksLikeMarkdown(value);

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
              (redacted — sha256 only)
            </span>
          )}
        </span>
      </button>
      {open && renderAsMarkdown && stringValue !== null && (
        <div className="markdown-body mt-2 break-words rounded border border-border/40 bg-bg px-4 py-3 text-sm leading-relaxed text-text-primary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {stringValue}
          </ReactMarkdown>
        </div>
      )}
      {open && !renderAsMarkdown && stringValue !== null && (
        <div className="mt-2 overflow-hidden rounded border border-border/40">
          <SyntaxHighlighter
            language={typeof value === "object" ? "json" : "bash"}
            style={agentscanTheme}
            wrapLines
            wrapLongLines
          >
            {stringValue}
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
          ✗ Unverified
        </span>
      );
    case "error":
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-accent-mock/40 bg-accent-mock/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent-mock"
          title={status.reason ?? "Verifier unreachable"}
        >
          ⚠ RPC error
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
