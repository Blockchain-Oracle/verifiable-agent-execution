#!/usr/bin/env python3
"""
.claude/hooks/visual_reviewer.py — fresh-context vision reviewer

Calls Opus 4.7 with anchor + current screenshots, returns structured slop-detection JSON.
Never exits non-zero — writes a soft verdict on any failure.

Usage:
    python3 visual_reviewer.py --anchor PATH --current PATH --out PATH
"""
import argparse
import base64
import json
import os
import pathlib
import sys
import traceback


SYSTEM = """You are a senior product designer reviewing AI-generated UI. You will receive two images.
IMAGE 1 (anchor): the reference product this build is meant to match in quality and feel.
IMAGE 2 (current): what the AI just built.

The 7 tells of AI-slop UI:
1. Median-purple gradient — default Tailwind purple-to-pink, no intention
2. Inter everywhere — single-weight Inter or system-ui, no typographic personality
3. Predictable card grid — 3-up cards, rounded-xl shadow-md, identical padding, no rhythm
4. Glossy-but-hollow — polished at thumbnail, falls apart on inspection
5. Spacing drift — random 4px multiples, no 8/12/16/24 system
6. Color of the week — brand color abused as semantic signal everywhere
7. Mock-data tells — John Doe, lorem ipsum, generic avatars, dollar amounts

Return ONLY valid JSON, no prose, no code fences:
{
  "verdict": "ok" | "needs-fix" | "slop",
  "slop_score": 0,
  "deltas": [{
    "category": "typography|color|spacing|hierarchy|density|motion|mock-data|structure",
    "severity": "blocking|high|medium|low",
    "anchor_state": "what anchor shows",
    "current_state": "what build shows",
    "fix": "specific actionable fix",
    "evidence": "specific visual feature to verify"
  }],
  "blocking_count": 0,
  "summary": "1 sentence — the single most important thing to fix"
}

Verdict rules:
- "ok"        when slop_score <= 2 AND blocking_count = 0
- "needs-fix" when slop_score 3-6 OR blocking_count >= 1
- "slop"      when slop_score >= 7 OR three or more of the 7 tells detected
"""


def b64(p: str) -> str:
    return base64.standard_b64encode(pathlib.Path(p).read_bytes()).decode()


def soft_fail(out_path: str, reason: str) -> None:
    pathlib.Path(out_path).write_text(json.dumps({
        "verdict": "skipped",
        "reason": reason,
    }))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--anchor", required=True)
    ap.add_argument("--current", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default=os.environ.get("VISUAL_REVIEW_MODEL", "claude-opus-4-7"))
    args = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        soft_fail(args.out, "ANTHROPIC_API_KEY not set")
        return 0

    if not pathlib.Path(args.anchor).is_file() or not pathlib.Path(args.current).is_file():
        soft_fail(args.out, f"missing image: anchor={args.anchor} current={args.current}")
        return 0

    try:
        import anthropic  # type: ignore
    except ImportError:
        soft_fail(args.out, "anthropic SDK not installed (pip install anthropic)")
        return 0

    try:
        client = anthropic.Anthropic()
        result = client.messages.create(
            model=args.model,
            max_tokens=2048,
            system=SYSTEM,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": "Image 1 (anchor):"},
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64(args.anchor)}},
                    {"type": "text", "text": "Image 2 (current build):"},
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64(args.current)}},
                    {"type": "text", "text": "Return the slop-detection JSON now."},
                ],
            }],
        )
        text = result.content[0].text.strip()
        # Strip stray fences if model added them
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:].lstrip()
        parsed = json.loads(text)
        pathlib.Path(args.out).write_text(json.dumps(parsed, indent=2))
        print(json.dumps(parsed, indent=2))
        return 0
    except Exception as exc:  # noqa: BLE001
        soft_fail(args.out, f"reviewer error: {exc}")
        traceback.print_exc(file=sys.stderr)
        return 0


if __name__ == "__main__":
    sys.exit(main())
