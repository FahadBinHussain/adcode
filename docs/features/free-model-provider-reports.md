# Free model provider reports

Administrators open **Free models → Provider reports**. Choose a UTC date range and a
model to review its provider briefing. All configured included models are listed, with
separate history for different upstream revisions and removed models.

The briefing includes an executive overview, adoption and repeat usage, daily demand,
input/output volumes, peak load, response speed, provider errors, ADCode rejections,
tool use and voluntary feedback. Full metric definitions and sample counts travel
with every HTML report. The same briefing can be printed to PDF; CSV and JSON are
available for analysis, plus all-model HTML and CSV downloads.

Reports also show the current configured context and reply capacity. Tagflow Code 27B
uses **262,144 tokens (256k)**, with input and reply sharing that window. Audience
tables break out network country, optional user role and coding experience, AI
assistant persona, observed workflow, optional declared primary purpose and operating
system. Each group includes distinct accounts, demand share, tokens, provider failures
and previous-period demand. Coverage counts and unknown groups accompany every dimension.

Users can open **AI usage → About your AI use** to opt into the role, experience and
purpose survey. Consent is off by default. Reports join the account's current choices;
changing or removing a profile changes newly generated historical reports too. Existing
downloaded copies cannot be recalled. Country comes from trusted Cloudflare request
metadata and describes the network connection, not verified residence. No IP address
or precise location is stored for these reports. Assistant/workflow categories are
fixed desktop metadata; custom agent names, instructions and prompts are not analysed.
Distinct users may appear in multiple country, persona and workflow groups.

Collection started October 11, 2026. The report states this date and flags incomplete
history; existing account totals cannot reconstruct past per-model requests.
Admin connection tests are excluded. Provider failure rate excludes ADCode rejections,
accounting errors and user cancellations. Response speed is observed at the relay,
including network effects, and is not an infrastructure or correctness benchmark.

New included AI replies have feedback actions. A user can submit a helpful/not-helpful
rating, topic and optional comment, then replace or remove that rating. Conversation
text and project files are not attached. Comment sharing is off by default; only
explicitly approved comments appear in provider reports. No account identifiers,
prompts, replies, code, secrets, tool arguments or raw provider errors are exported.

Technical setup and retention details are in [Included AI setup](../TAGFLOW-SETUP.md).
