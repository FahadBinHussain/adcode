# ADCode 2.3 — launch film

1920 × 1080, 60 fps, 44 seconds, H.264 + AAC at about −14 LUFS. No voiceover, no samples
and no licensed music: the picture is HTML drawn frame by frame, and the quiet ambient score
is synthesised from the same cue sheet.

Styled like a calm product launch film: short centred title cards that arrive a line at a
time, slow eased camera moves over clean framed shots of the real 2.3 UI, and plenty of
black. Built from what 2.3 actually ships (see `CHANGELOG.md`, 2.3.0 and 2.3.1), in the
app's own dark palette, type, mark and mascots:

| Time | What is on screen |
| --- | --- |
| 0 – 4 | The mark, "Introducing ADCode 2.3" |
| 4 – 14 | "Agents that work right in the chat." `/team` sent as typed; Builder, Tester and Reviewer work in live windows inside the conversation, hand work on, and finish with the checks they ran |
| 14 – 20 | "Every edit, one click from undone." The Edited files card: per-file counts, the recorded diff, Undo |
| 20 – 26.5 | "Free AI, included." 1,000,000 tokens a day, no API key; Connect a model with Tagflow Code 27B |
| 26.5 – 33.5 | "Out of tokens? Switch models. Keep going." The composer's ring meters; the daily allowance runs out, the chat waits for the reset, and picking a local model continues the turn |
| 33.5 – 37 | AI usage: totals, streaks, the yearly activity calendar |
| 37 – 44 | ADCode 2.3, "Agents in the chat. Free AI included.", where to get it, the five starter agents |

The product scenes are each written as one continuous take in scene time (`CUE`), and
`SEGMENTS` in `stage/cues.js` picks which stretches play at which film times, so the film
can cut away to a title card and come back mid-story.

Colour follows the app's rule: monochrome chrome, with colour spent only on meaning — the
agents' own mascot colours, green for checks passed and for what is free, amber for a
limit, red and green in a diff. Figures in the usage view and the model names in the menu
are examples.

```
node marketing/ad-payback/fetch-tools.mjs          # once: ffmpeg and fonts, shared with the other ads
node marketing/launch-2-3/render.mjs               # the deliverable, poster and stills, into out/
node marketing/launch-2-3/render.mjs --stills 10.6,24.4,41.5
node marketing/launch-2-3/render.mjs --from 6 --to 14 --no-audio --fps 30
```

The renderer drives Playwright's Chromium (a global `npm install -g playwright` is enough),
so it does not need the desktop app's Electron. The cue sheet is `stage/cues.js`; the frame
engine and the mark are borrowed from `ad-payback/stage` through the `/shared/` route.
