/**
 * The soundtrack: 44 seconds of slow, quiet A minor (Am F C G, four seconds a chord),
 * synthesised offline - soft pads, a few bell notes on each chord, a low swell under every
 * title card, and the interface's own small sounds placed on the film-time moments they
 * belong to. No drums, no samples, no licensed music. Seeded noise, so it renders the same
 * every time. Returned as 16-bit stereo WAV bytes. The instruments are the Payback ad's.
 */
import { CARDS, CUE, DURATION, END, PROMPT, SEGMENTS, TITLE, filmTime } from "./cues.js";
import { rng } from "/shared/engine.js";

const RATE = 48000;

const CHORDS = {
  Am: { root: 55, pad: [220, 261.63, 329.63], arp: [440, 523.25, 659.25, 880] },
  F: { root: 43.65, pad: [174.61, 220, 261.63], arp: [349.23, 440, 523.25, 698.46] },
  C: { root: 65.41, pad: [196, 261.63, 329.63], arp: [392, 523.25, 659.25, 783.99] },
  G: { root: 49, pad: [196, 246.94, 293.66], arp: [392, 493.88, 587.33, 783.99] },
};
const REDO = "Redo it with local dates";
const STARTER_TONES = [1046.5, 1174.66, 1318.51, 1567.98, 1760];

export async function renderSoundtrack() {
  const ctx = new OfflineAudioContext(2, Math.round(DURATION * RATE), RATE);
  const random = rng(3000);
  const noise = ctx.createBuffer(1, RATE * 2, RATE);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) samples[i] = random() * 2 - 1;

  // ── The mix: buses → compressor → limiter → out, with a shared reverb ──
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16; glue.knee.value = 6; glue.ratio.value = 3.5; glue.attack.value = 0.006; glue.release.value = 0.18;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.9, 0.6);
  master.gain.setValueAtTime(0.9, END.fade);
  master.gain.linearRampToValueAtTime(0, DURATION);
  master.connect(glue).connect(limiter).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  const tail = ctx.createBuffer(2, Math.round(RATE * 4), RATE);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = tail.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) data[i] = (random() * 2 - 1) * (1 - i / data.length) ** 3.2;
  }
  reverb.buffer = tail;
  const wet = ctx.createGain();
  wet.gain.value = 0.42;
  reverb.connect(wet).connect(master);

  const drums = ctx.createGain(); drums.gain.value = 0.9; drums.connect(master);
  const fx = ctx.createGain(); fx.gain.value = 0.8; fx.connect(master);
  const pump = ctx.createGain(); pump.gain.value = 1;
  const musicFilter = ctx.createBiquadFilter();
  musicFilter.type = "lowpass"; musicFilter.Q.value = 0.5; musicFilter.frequency.value = 2400;
  const music = ctx.createGain(); music.gain.value = 0.62;
  music.connect(pump).connect(musicFilter).connect(master);

  const send = (node, amount) => {
    const gain = ctx.createGain(); gain.gain.value = amount;
    node.connect(gain).connect(reverb);
  };
  const env = (gain, t, level, attack, decay) => {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const noiseSource = (t, duration) => {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    source.start(t, random() * 1.2, duration + 0.05);
    return source;
  };
  const filter = (type, frequency, q = 1) => {
    const node = ctx.createBiquadFilter();
    node.type = type; node.frequency.value = frequency; node.Q.value = q;
    return node;
  };
  const panner = (pan) => {
    const node = ctx.createStereoPanner(); node.pan.value = pan;
    return node;
  };

  // ── Instruments ──
  function kick(t, level = 1) {
    const body = ctx.createOscillator(); const gain = ctx.createGain();
    body.frequency.setValueAtTime(160, t);
    body.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    env(gain, t, level, 0.002, 0.42);
    body.connect(gain).connect(drums);
    body.start(t); body.stop(t + 0.5);
    const click = noiseSource(t, 0.03); const clickGain = ctx.createGain();
    env(clickGain, t, 0.25 * level, 0.001, 0.02);
    click.connect(filter("highpass", 2600)).connect(clickGain).connect(drums);
    pump.gain.setValueAtTime(0.5, t);
    pump.gain.linearRampToValueAtTime(1, t + 0.24);
  }

  function clap(t, level = 0.5) {
    const source = noiseSource(t, 0.3); const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    for (const offset of [0, 0.011, 0.022]) {
      gain.gain.setValueAtTime(level, t + offset);
      gain.gain.exponentialRampToValueAtTime(level * 0.2, t + offset + 0.01);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    source.connect(filter("bandpass", 1400, 0.9)).connect(gain).connect(drums);
    send(gain, 0.28);
  }

  function hat(t, level = 0.12, open = false, pan = 0) {
    const source = noiseSource(t, open ? 0.3 : 0.06); const gain = ctx.createGain();
    env(gain, t, level, 0.001, open ? 0.26 : 0.04);
    source.connect(filter("highpass", 7800)).connect(gain).connect(panner(pan)).connect(drums);
  }

  function bass(t, frequency, duration, level = 0.34) {
    const gain = ctx.createGain();
    const low = filter("lowpass", 180, 5);
    low.frequency.setValueAtTime(160, t);
    low.frequency.exponentialRampToValueAtTime(760, t + 0.03);
    low.frequency.exponentialRampToValueAtTime(240, t + duration);
    env(gain, t, level, 0.004, duration);
    for (const cents of [-6, 6]) {
      const osc = ctx.createOscillator(); osc.type = "sawtooth";
      osc.frequency.value = frequency * 2; osc.detune.value = cents;
      osc.connect(low); osc.start(t); osc.stop(t + duration + 0.1);
    }
    low.connect(gain).connect(music);
  }

  function pluck(t, frequency, level = 0.11, pan = 0) {
    const gain = ctx.createGain();
    const low = filter("lowpass", 3600, 2.5);
    low.frequency.setValueAtTime(4200, t);
    low.frequency.exponentialRampToValueAtTime(650, t + 0.28);
    env(gain, t, level, 0.003, 0.34);
    for (const [type, cents] of [["sawtooth", -5], ["square", 5]]) {
      const osc = ctx.createOscillator(); osc.type = type;
      osc.frequency.value = frequency; osc.detune.value = cents;
      osc.connect(low); osc.start(t); osc.stop(t + 0.45);
    }
    low.connect(gain).connect(panner(pan)).connect(music);
    send(gain, 0.35);
  }

  function pad(t, frequencies, duration, level = 0.05) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + Math.min(0.6, duration / 2));
    gain.gain.setValueAtTime(level, t + duration - 0.3);
    gain.gain.linearRampToValueAtTime(0.0001, t + duration + 0.6);
    const low = filter("lowpass", 1200, 0.6);
    for (const frequency of frequencies) {
      for (const cents of [-9, 9]) {
        const osc = ctx.createOscillator(); osc.type = "sawtooth";
        osc.frequency.value = frequency; osc.detune.value = cents;
        osc.connect(low); osc.start(t); osc.stop(t + duration + 0.7);
      }
    }
    low.connect(gain).connect(music);
    send(gain, 0.5);
  }

  function riser(t0, t1, level = 0.2) {
    const source = noiseSource(t0, t1 - t0); const gain = ctx.createGain();
    const band = filter("bandpass", 400, 2.2);
    band.frequency.setValueAtTime(400, t0);
    band.frequency.exponentialRampToValueAtTime(7200, t1);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(level, t1 - 0.02);
    gain.gain.linearRampToValueAtTime(0, t1);
    source.connect(band).connect(gain).connect(fx);
    send(gain, 0.3);
  }

  function whoosh(t, duration = 0.45, level = 0.3, up = false, from = -0.6, to = 0.6) {
    const source = noiseSource(t, duration); const gain = ctx.createGain();
    const band = filter("bandpass", up ? 500 : 6000, 1.1);
    band.frequency.setValueAtTime(up ? 500 : 6000, t);
    band.frequency.exponentialRampToValueAtTime(up ? 6000 : 450, t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + duration * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(from, t);
    pan.pan.linearRampToValueAtTime(to, t + duration);
    source.connect(band).connect(gain).connect(pan).connect(fx);
    send(gain, 0.2);
  }

  function tone(t, frequency, duration, level, type = "sine", toFrequency = null) {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (toFrequency !== null) osc.frequency.exponentialRampToValueAtTime(toFrequency, t + duration);
    env(gain, t, level, 0.003, duration);
    osc.connect(gain).connect(fx);
    osc.start(t); osc.stop(t + duration + 0.05);
    return gain;
  }

  function coin(t, level = 0.22) {
    tone(t, 987.77, 0.08, level, "square");
    const ring = tone(t + 0.075, 1318.51, 0.9, level, "square");
    send(ring, 0.45);
  }

  function key(t, level = 0.06) {
    const source = noiseSource(t, 0.03); const gain = ctx.createGain();
    env(gain, t, level, 0.001, 0.022);
    source.connect(filter("bandpass", 3200 + random() * 900, 1.6)).connect(gain).connect(panner(random() * 0.6 - 0.3)).connect(fx);
  }

  function click(t, level = 0.14) {
    key(t, level);
    tone(t, 1250, 0.03, level * 0.6);
  }

  function boom(t, level = 0.9) {
    const body = ctx.createOscillator(); const gain = ctx.createGain();
    body.frequency.setValueAtTime(64, t);
    body.frequency.exponentialRampToValueAtTime(33, t + 1.4);
    env(gain, t, level, 0.004, 1.8);
    body.connect(gain).connect(fx); body.start(t); body.stop(t + 2);
    const crack = noiseSource(t, 0.8); const crackGain = ctx.createGain();
    env(crackGain, t, level * 0.35, 0.002, 0.7);
    crack.connect(filter("lowpass", 1100)).connect(crackGain).connect(fx);
    send(crackGain, 0.4);
  }

  function crash(t, level = 0.12) {
    const source = noiseSource(t, 1.6); const gain = ctx.createGain();
    env(gain, t, level, 0.002, 1.5);
    source.connect(filter("highpass", 5200)).connect(gain).connect(drums);
    send(gain, 0.3);
  }

  // ── The score ──
  function bell(t, frequency, level = 0.05, pan = 0) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    for (const [ratio, amount] of [[1, 1], [2, 0.18], [3, 0.05]]) {
      const osc = ctx.createOscillator(); const partial = ctx.createGain();
      osc.frequency.value = frequency * ratio; partial.gain.value = amount;
      osc.connect(partial).connect(gain); osc.start(t); osc.stop(t + 2.7);
    }
    gain.connect(panner(pan)).connect(music);
    send(gain, 0.6);
  }
  function swell(t, duration = 2.2, level = 0.1) {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.frequency.value = 55;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + duration * 0.4);
    gain.gain.linearRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(music); osc.start(t); osc.stop(t + duration + 0.1);
  }
  const at = (scene, t) => filmTime(scene, t);
  const soft = (t, f) => { if (t !== null) f(t); };

  // The bed: a pad per chord, four seconds each, and three bell notes over it.
  const ORDER = ["Am", "F", "C", "G"];
  for (let bar = 0, i = 0; bar < DURATION - 1; bar += 4, i += 1) {
    const chord = CHORDS[ORDER[i % 4]];
    pad(bar, chord.pad, 4, 0.04);
    if (bar >= 4 && bar < 36) {
      [0, 1.5, 2.5].forEach((offset, j) => bell(bar + offset, chord.arp[[0, 2, 1][j]] , 0.035, j % 2 ? 0.3 : -0.3));
    }
  }
  // Title and end: a chord in bells.
  CHORDS.Am.arp.forEach((f, i) => bell(TITLE.name + i * 0.09, f, 0.04, i % 2 ? 0.25 : -0.25));
  swell(0.2, 3.4, 0.08);
  CHORDS.Am.arp.forEach((f, i) => bell(END.mark + i * 0.11, f, 0.045, i % 2 ? 0.25 : -0.25));
  pad(END.mark, [110, 164.81, 220, 261.63, 329.63], 5.4, 0.05);
  swell(END.from, 3, 0.09);
  // Cards: a low swell and a single high note.
  CARDS.forEach((card) => { swell(card.at - 0.3, 2.4, 0.09); bell(card.at + 0.15, 1318.51, 0.03); });
  // Air on every cut into and out of the product.
  for (const list of Object.values(SEGMENTS)) for (const s of list) whoosh(s.at - 0.2, 0.9, 0.035, true, -0.3, 0.3);

  // The interface's own sounds, quiet.
  [...PROMPT].forEach((_, i) => soft(at("chat", CUE.typeStart + i / CUE.typeRate), (t) => key(t, 0.025)));
  [...REDO].forEach((_, i) => soft(at("chat", CUE.meters + 0.2 + i / 34), (t) => key(t, 0.022)));
  for (const c of [CUE.send, CUE.review, CUE.undoPress, CUE.menu, CUE.pick, CUE.redo]) soft(at("chat", c), (t) => click(t, 0.06));
  for (const c of [CUE.handoff, CUE.note]) soft(at("chat", c), (t) => bell(t, 1567.98, 0.03, 0.2));
  CUE.checks.forEach((c, i) => soft(at("chat", c), (t) => bell(t, 1760 * 1.12 ** i, 0.028)));
  soft(at("chat", CUE.limit), (t) => { bell(t, 659.25, 0.035); bell(t + 0.18, 523.25, 0.035); });
  soft(at("chat", CUE.resumed), (t) => bell(t, 1318.51, 0.03));
  soft(at("free", CUE.countLand), (t) => { bell(t, 880, 0.045); bell(t + 0.08, 1318.51, 0.035); });
  soft(at("usage", CUE.calendar + 1.5), (t) => bell(t, 2093, 0.025));
  STARTER_TONES.forEach((f, i) => bell(END.mascots + i * 0.12, f, 0.018));

  return wav(await ctx.startRendering());
}

/** 16-bit PCM WAV, interleaved stereo. */
function wav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = new DataView(new ArrayBuffer(44 + frames * channels * 2));
  const text = (at, value) => [...value].forEach((char, i) => bytes.setUint8(at + i, char.charCodeAt(0)));
  text(0, "RIFF"); bytes.setUint32(4, 36 + frames * channels * 2, true); text(8, "WAVE");
  text(12, "fmt "); bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, channels, true);
  bytes.setUint32(24, buffer.sampleRate, true); bytes.setUint32(28, buffer.sampleRate * channels * 2, true);
  bytes.setUint16(32, channels * 2, true); bytes.setUint16(34, 16, true);
  text(36, "data"); bytes.setUint32(40, frames * channels * 2, true);
  const data = [...Array(channels).keys()].map((channel) => buffer.getChannelData(channel));
  let at = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, data[channel][frame]));
      bytes.setInt16(at, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      at += 2;
    }
  }
  return new Uint8Array(bytes.buffer);
}
