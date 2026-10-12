# Token usage audit — 11 October 2026

The account in the supplied screenshots had 67 included requests today: 919,303 input
tokens and 7,524 output tokens, totaling 926,827. The daily database ledger, account API
and screenshot agree. Estimated requests and outstanding reservations were both zero.
These settled counts came from the provider, rather than the relay's text estimate.

The local all-time total was 7,096,142 tokens across 191 requests and five models over
10–11 October. OpenRouter accounted for 6,005,421 of those tokens. Only the two Ollama
requests were estimated. This local all-model history is separate from today's shared
included allowance and does not subtract another 7.1M tokens from that allowance.

## Fault and correction

Before the fix, context validation estimated input as UTF-8 bytes / 3 plus framing,
but the allowance reservation counted every UTF-8 byte as one token. The rejected chat
had estimated input of 24,832 tokens and a 4,096-token reply limit. A roughly 29k-token
reservation fits 73,173 remaining tokens, while the inflated byte reservation did not.
The rejection itself did not consume tokens or increment the settled request count.

Context checks, token reservations and missing-usage input settlements now share the
same token estimate. Exact tokenization depends on the provider; its reported counts
remain authoritative and can differ from the estimate. Reply room and atomic account
reservations remain enforced. Settlements still reconcile the provider's real total.

Missing output counts now estimate generated content, reasoning and tool arguments,
excluding the JSON/SSE envelope repeated around each streamed fragment. Groq's
`x_groq.usage` counts are recognized. Cached-input and reasoning details are not added
again to totals that already include them. Final counts observed before a subsequent
transport interruption are retained; uncertain requests without final counts still
consume their maximum reservation. Definite HTTP refusals release the allocation.

The usage dialog shows input/output counts and identifies estimated requests. Its help
explains that each AI step resends context and counts that input again. Local history
now explicitly describes its selected period and all-model scope. The composer tooltip
also includes input/output counts and repeated-context guidance.

## Verification

- Regression: ~26k estimated input plus reply accepted with 73,173 tokens remaining;
  the real provider tally replaces the reservation once, releasing unused reply room.
- Genuine shortage, reply room, concurrent reservations, per-account ownership, UTC
  resets, unsupported formats, credential protection and refusals remain covered.
- Missing-usage output estimates agree for identical text sent in one or 90 chunks.
- Provider counts survive cancellation after the final tally; missing counts retain
  the conservative cancellation rule. Groq, cached-input and reasoning totals are covered.
- Usage dialog checked in Chromium across three themes and 1100/680/360-pixel windows,
  including visible input/output counts, estimate labels and retained keyboard focus.
- Targeted suites: 62 tests, including the desktop/relay integration and 26 Chromium
  assertions. Type checks and the
  dependency boundary check pass (existing orphan warnings only).

No historical daily balances were rewritten: today's settled counts were accurate.

## Published result

Cloudflare deployment `f06102a9-1514-4a1e-91d3-8c4f095f62cb` completed successfully.
Live administrator verification request `fab10bdb-ed75-4bc4-bb57-1165622b4d8a`
reported 16 input tokens and two output tokens. The account ledger increased by exactly
one request and those 18 tokens, with zero estimates and no remaining reservation.
The balance after this check was 73,155 tokens. The test is excluded from customer
demand. The live catalog retains 262,144 context tokens and the saved allowance remains
1,000,000 daily tokens with unlimited requests.

The desktop build completed successfully. Fully quit ADCode and reopen with
`adcode open` to load the new usage explanation and input/output breakdown.
