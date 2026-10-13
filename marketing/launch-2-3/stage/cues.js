/**
 * Every moment the picture and the sound both care about. Two clocks:
 *
 *   - film time, 0 – 44 s, what the viewer sees: title cards between calm product shots;
 *   - scene time (CUE below), the continuous take each product scene was written in.
 *
 * SEGMENTS says which stretch of scene time plays at which stretch of film time, so the
 * chat can be one continuous story while the film cuts away to a title card and back.
 * The soundtrack reads both through `filmTime`, so a click lands on its click.
 */
export const DURATION = 44;

export const SEGMENTS = {
  chat: [
    { at: 6.5, to: 14.0, from: 4.0, until: 11.0 },
    { at: 16.0, to: 20.0, from: 11.0, until: 15.0 },
    { at: 28.5, to: 33.5, from: 20.6, until: 26.0 },
  ],
  free: [{ at: 22.0, to: 26.5, from: 15.9, until: 20.4 }],
  usage: [{ at: 33.5, to: 37.2, from: 26.0, until: 29.7 }],
};

export const CARDS = [
  { at: 4.0, to: 6.5, lines: ["Agents that work", "right in the chat."] },
  { at: 14.0, to: 16.0, lines: ["Every edit,", "one click from undone."] },
  { at: 20.0, to: 22.0, lines: ["Free AI,", "included."] },
  { at: 26.5, to: 28.5, lines: ["Out of tokens?", "Switch models. Keep going."] },
];

export const TITLE = { introducing: 0.6, name: 1.3, out: 3.4 };
export const END = { from: 37.2, mark: 37.7, name: 38.3, line: 39.0, where: 39.8, mascots: 40.5, fade: 43.0 };

/** The film time at which `scene` reaches scene time `t`, or null when that moment is cut. */
export function filmTime(scene, t) {
  for (const s of SEGMENTS[scene]) {
    if (t >= s.from && t <= s.until) return s.at + ((t - s.from) * (s.to - s.at)) / (s.until - s.from);
  }
  return null;
}
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const PROMPT = "/team Add streaks to the habit tracker";

export const CUE = {
  // 0 · The number
  bracketsIn: 0.15,
  bracketsLand: 0.9,
  number: 1.0,
  kicker: 1.6,
  part: 3.5,
  // 1 · Agents in the chat (one continuous window, 3.6 – 26)
  chatIn: 3.6,
  typeStart: 4.4,
  typeRate: PROMPT.length / 1.2,
  send: 5.8,
  team: 6.0,
  agentsStart: 6.3,
  handoff: 7.6,
  note: 8.6,
  checks: [9.9, 10.15, 10.4],
  teamDone: 10.8,
  // 2 · Every edit, undoable
  edits: 11.0,
  review: 12.4,
  undoPress: 14.0,
  // 3 · Included AI (a full-frame interlude over the window)
  free: 15.8,
  count: 16.0,
  countLand: 17.4,
  freeWord: 17.5,
  models: 18.4,
  signIn: 19.3,
  freeOut: 20.4,
  // 4 · Meters, a limit, and a switch
  back: 20.6,
  meters: 20.9,
  redo: 21.85,
  limit: 22.4,
  chip: 23.2,
  menu: 23.5,
  pick: 24.1,
  resumed: 24.4,
  // 5 · AI usage
  usage: 26.0,
  calendar: 26.4,
  stats: 27.6,
  // 6 · Montage, a cut a beat
  montage: [30.0, 30.5, 31.0, 31.5],
  // 7 · The mark
  implode: 32.0,
  silence: 33.75,
  logo: 34.0,
  wordmark: 34.45,
  tagline: 35.1,
  settle: 35.7,
  endLines: [36.1, 36.5, 36.9],
  fadeOut: 39.2,
};
