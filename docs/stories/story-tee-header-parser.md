# Story: tee-header-parser

**Epic:** Epic 2 — TEE Proof Adapter  
**Estimated time:** ~1h  
**Dependencies:** None

---

## Narrative

As a TEE adapter developer, I need to parse the ZG-Res-Key header that 0G Private Computer returns with every inference response, extracting the signed text and ECDSA signature.

---

## Acceptance criteria

```gherkin
Given a mock HTTP response with header ZG-Res-Key: '{"text": "Hello", "signature": "0x...", "signing_address": "0x04581d...", "signing_algo": "ecdsa"}'
When HeaderParser.parse(headerValue: string) is called
Then it returns { text: string, signature: string, signingAddress: string }
And JSON.parse() does not throw on the result

Given a malformed header (invalid JSON)
When HeaderParser.parse() is called
Then it throws ParseError with a descriptive message

Given a header with missing required fields (e.g., missing "signature")
When validation runs
Then an error is thrown indicating which field is missing
```

---

## File modification map

**Create:**
- `packages/tee-adapter/src/HeaderParser.ts` — parse() function with Zod schema
- `packages/tee-adapter/src/types.ts` — ParsedZGResKey type definition
- `packages/tee-adapter/tests/header-parser.test.ts` — Test valid parse, malformed JSON, missing fields, edge cases

**Update:**
- `packages/tee-adapter/src/index.ts` — Export HeaderParser, ParsedZGResKey

---

## Shell verification

```bash
pnpm --filter=tee-adapter vitest run header-parser.test.ts
# Must exit 0 with all tests passing
```
