/**
 * LogEntry — single ExecutionLogEntry card.
 *
 * Renders the proof's per-row content: seq + timestamp + tool name,
 * plus the inputHash/outputHash mono-rendered for verifier read.
 * The TEE-signature presence is shown via a small marker (UX-spec
 * `accent-verify` dot when present, absent indicator when not) so a
 * verifier can scan for which steps had attestation without opening
 * each card.
 *
 * Layout matches the Trigger.dev run-detail anchor (per UX spec
 * § Anchor): left column is the metadata stack (seq, ts), right is
 * the I/O hash block. Card padding follows the 4px base scale.
 */

type LogEntryProps = {
  entry: {
    seq: number;
    ts: number;
    type: string;
    tool?: string;
    inputHash: string;
    outputHash: string;
    hasTeeSignature: boolean;
  };
};

export function LogEntry({ entry }: LogEntryProps) {
  const dt = new Date(entry.ts);
  const isoTimestamp = dt.toISOString();
  return (
    <article className="rounded-lg border border-border bg-surface p-4">
      <header className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs text-text-secondary">
            #{entry.seq.toString().padStart(3, "0")}
          </span>
          <span className="text-sm font-medium text-text-primary">
            {entry.tool ?? entry.type}
          </span>
          <span className="rounded bg-surface-elev px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-text-secondary">
            {entry.type}
          </span>
        </div>
        <time
          dateTime={isoTimestamp}
          title={isoTimestamp}
          className="font-mono text-xs text-text-secondary"
        >
          {dt.toLocaleTimeString("en-US", { hour12: false })}
        </time>
      </header>

      <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-text-secondary">inputHash</dt>
          <dd className="mt-0.5 break-all font-mono text-text-primary">{entry.inputHash}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">outputHash</dt>
          <dd className="mt-0.5 break-all font-mono text-text-primary">{entry.outputHash}</dd>
        </div>
      </dl>

      <footer className="mt-3 flex items-center gap-2">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${entry.hasTeeSignature ? "bg-accent-verify" : "bg-border"}`}
        />
        <span className="text-xs text-text-secondary">
          {entry.hasTeeSignature ? "TEE signature present" : "No TEE signature"}
        </span>
      </footer>
    </article>
  );
}
