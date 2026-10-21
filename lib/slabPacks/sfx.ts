'use client';

/**
 * Slab Packs — sound design, synthesised with Web Audio.
 *
 * Every sound is built at play time, so the feature ships no audio files:
 * nothing to download before the first rip, nothing to license, and each
 * layer can follow the gesture or the pull that triggered it (the tear tracks
 * the finger, the reveal scales with the hit class).
 *
 * The physical sounds are modelled on the objects, not on generic UI blips:
 *   - foil is CRACKLE: thousands of tiny stick-slip snaps, not a hiss. Two
 *     pre-built buffers of random noise bursts (dense for a tear, sparse for
 *     a crinkle) are played through the bright resonances of thin film, and
 *     a faster finger plays them faster, which is how a real rip rises in
 *     pitch;
 *   - a slab is a block of acrylic: a knock is a handful of short, high,
 *     slightly inharmonic ring modes (slabTap);
 *   - coins are metal: longer, glassier modes, several of them landing.
 * The musical layer (the tell, the reveal fanfares) stays in one key,
 * C major pentatonic, so stacked sounds agree with each other.
 *
 * SfxKit takes any BaseAudioContext, which lets the same code render into an
 * OfflineAudioContext for level checks. The `sfx` singleton below is what the
 * UI calls; it stays silent until `unlock()` runs inside a user gesture
 * (browsers refuse to start audio otherwise) and while sound is switched off.
 */

// C major pentatonic plus the leading tones the fanfares use, in Hz.
const N = {
    C3: 130.81, D3: 146.83, E3: 164.81, G3: 196.0, A3: 220.0, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63, Fs4: 369.99, G4: 392.0, Gs4: 415.3, A4: 440.0, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, Fs5: 739.99, G5: 783.99, Gs5: 830.61, A5: 880.0, B5: 987.77,
    C6: 1046.5, D6: 1174.66, E6: 1318.51, Fs6: 1479.98, G6: 1567.98, A6: 1760.0, B6: 1975.53,
    C7: 2093.0, E7: 2637.02,
};

interface ToneOpts {
    f: number;
    /** Glide target; the pitch sweeps exponentially over the tone. */
    f2?: number;
    t?: number;
    dur: number;
    gain: number;
    type?: OscillatorType;
    attack?: number;
    /** Share of the signal also sent to the reverb. */
    send?: number;
    detune?: number;
}

interface NoiseOpts {
    t?: number;
    dur: number;
    gain: number;
    filter: BiquadFilterType;
    f: number;
    f2?: number;
    q?: number;
    attack?: number;
    send?: number;
}

interface BellOpts {
    f: number;
    t?: number;
    dur: number;
    gain: number;
    /** Modulator ratio: 2 is warm, 3.5 glassy, 2.76 metallic. */
    ratio?: number;
    index?: number;
    send?: number;
}

export interface ChargeHandle {
    /** Cut the riser dead (the breath before the reveal lands). */
    stop: () => void;
}

export interface TearHandle {
    /** progress 0..1 along the tear line, speed 0..1 of the finger. */
    move: (progress: number, speed: number) => void;
    end: () => void;
}

export class SfxKit {
    readonly ctx: BaseAudioContext;
    private bus: GainNode;
    private send: GainNode;
    private noise: AudioBuffer;
    /** Dense crackle: foil tearing. */
    private tearBuf: AudioBuffer;
    /** Sparse crackle: foil being handled. */
    private crinkleBuf: AudioBuffer;

    constructor(ctx: BaseAudioContext, destination?: AudioNode) {
        this.ctx = ctx;
        const out = destination ?? ctx.destination;

        // Everything meets at a compressor so a big reveal (sub + chord +
        // crash + shimmer at once) lands loud without clipping.
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.knee.value = 12;
        comp.ratio.value = 5;
        comp.attack.value = 0.004;
        comp.release.value = 0.18;
        const master = ctx.createGain();
        master.gain.value = 0.72;
        comp.connect(master).connect(out);

        this.bus = ctx.createGain();
        this.bus.connect(comp);

        // A generated impulse (decaying stereo noise) stands in for a hall.
        const reverb = ctx.createConvolver();
        reverb.buffer = this.impulse(2.4, 2.6);
        const wet = ctx.createGain();
        wet.gain.value = 0.5;
        this.send = ctx.createGain();
        this.send.connect(reverb).connect(wet).connect(comp);

        this.noise = this.makeNoise(2);
        this.tearBuf = this.makeCrackle(2.5, 520, 0.035);
        this.crinkleBuf = this.makeCrackle(2.5, 60, 0);
    }

    /**
     * Crackle: noise bursts fired at random (a Poisson process), each a
     * fraction of a millisecond to a few milliseconds long, mostly small with
     * the odd big one. `floor` leaves a faint continuous hiss under a dense
     * tear so it never drops to silence between snaps.
     */
    private makeCrackle(seconds: number, perSecond: number, floor: number): AudioBuffer {
        const sr = this.ctx.sampleRate;
        const len = Math.floor(sr * seconds);
        const buf = this.ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        const chance = perSecond / sr;
        let env = 0;
        let decay = 0.99;
        for (let i = 0; i < len; i++) {
            if (Math.random() < chance) {
                const size = 0.12 + 0.88 * Math.pow(Math.random(), 3);
                if (size > env) {
                    env = size;
                    decay = Math.exp(-1 / (sr * (0.00025 + Math.random() * 0.0022)));
                }
            }
            data[i] = (Math.random() * 2 - 1) * Math.max(env, floor);
            env *= decay;
        }
        return buf;
    }

    /**
     * Thin film: nothing below 1 kHz, two bright resonances, and the very top
     * rolled off so it reads as crisp rather than hissy on a phone speaker.
     */
    private foil(dest: AudioNode): AudioNode {
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1100;
        const a = this.ctx.createBiquadFilter();
        a.type = 'peaking';
        a.frequency.value = 2900;
        a.Q.value = 2.2;
        a.gain.value = 7;
        const b = this.ctx.createBiquadFilter();
        b.type = 'peaking';
        b.frequency.value = 6200;
        b.Q.value = 2.8;
        b.gain.value = 4;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 6400;
        lp.Q.value = 0.7;
        const lp2 = this.ctx.createBiquadFilter();
        lp2.type = 'lowpass';
        lp2.frequency.value = 9500;
        lp2.Q.value = 0.6;
        hp.connect(a).connect(b).connect(lp).connect(lp2).connect(dest);
        return hp;
    }

    /** One shaped burst of foil crackle. `rate` is playback speed (pitch). */
    private crackle(o: { tear?: boolean; t?: number; dur: number; gain: number; rate?: number; rate2?: number; attack?: number; send?: number }) {
        const t0 = this.at(o.t);
        const src = this.ctx.createBufferSource();
        src.buffer = o.tear ? this.tearBuf : this.crinkleBuf;
        src.loop = true;
        src.playbackRate.setValueAtTime(o.rate ?? 1, t0);
        if (o.rate2) src.playbackRate.exponentialRampToValueAtTime(o.rate2, t0 + o.dur);
        src.connect(this.foil(this.voice(t0, o.dur, o.gain, o.attack ?? 0.003, o.send ?? 0.08)));
        src.start(t0, Math.random() * 2);
        src.stop(t0 + o.dur + 0.02);
    }

    /**
     * Acrylic on acrylic: the knock of a slab being set down or snapped
     * face-up. Five short ring modes, a click on the front and a little body.
     */
    slabTap(strength = 1, t = 0) {
        const modes: [number, number, number][] = [[1240, 0.12, 1], [2110, 0.1, 0.7], [3050, 0.08, 0.55], [4380, 0.06, 0.4], [6100, 0.045, 0.3]];
        for (const [f, dur, g] of modes) {
            this.tone({ f: f * (0.97 + Math.random() * 0.06), t, dur, gain: 0.2 * g * strength, attack: 0.0008, send: 0.12 });
        }
        this.noiseHit({ t, dur: 0.007, gain: 0.3 * strength, filter: 'highpass', f: 3000, attack: 0.0005 });
        this.tone({ f: 270, f2: 180, t, dur: 0.055, gain: 0.26 * strength, type: 'triangle', attack: 0.001 });
    }

    /** One coin landing: metal rings longer and glassier than acrylic. */
    private coin(t: number, gain: number) {
        const f = 3100 + Math.random() * 1500;
        for (const [ratio, dur, g] of [[1, 0.26, 1], [1.47, 0.2, 0.6], [2.09, 0.15, 0.45], [2.56, 0.1, 0.3]]) {
            this.tone({ f: f * ratio, t, dur, gain: gain * g, attack: 0.0006, send: 0.25 });
        }
        this.noiseHit({ t, dur: 0.005, gain: gain * 1.2, filter: 'highpass', f: 5000, attack: 0.0005 });
    }

    private makeNoise(seconds: number): AudioBuffer {
        const len = Math.floor(this.ctx.sampleRate * seconds);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        return buf;
    }

    private impulse(seconds: number, decay: number): AudioBuffer {
        const len = Math.floor(this.ctx.sampleRate * seconds);
        const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = buf.getChannelData(ch);
            let lp = 0;
            for (let i = 0; i < len; i++) {
                const env = Math.pow(1 - i / len, decay);
                // One-pole lowpass on the tail so the reverb darkens as it dies.
                lp += (Math.random() * 2 - 1 - lp) * (0.25 + 0.75 * env);
                data[i] = lp * env;
            }
        }
        return buf;
    }

    private at(t?: number): number {
        return this.ctx.currentTime + 0.006 + (t ?? 0);
    }

    /** Attack-decay envelope on a fresh gain node wired to the bus (+ reverb). */
    private voice(t0: number, dur: number, peak: number, attack: number, send: number): GainNode {
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        g.connect(this.bus);
        if (send > 0) {
            const s = this.ctx.createGain();
            s.gain.value = send;
            g.connect(s).connect(this.send);
        }
        return g;
    }

    private tone(o: ToneOpts) {
        const t0 = this.at(o.t);
        const osc = this.ctx.createOscillator();
        osc.type = o.type ?? 'sine';
        osc.frequency.setValueAtTime(o.f, t0);
        if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.dur);
        if (o.detune) osc.detune.value = o.detune;
        osc.connect(this.voice(t0, o.dur, o.gain, o.attack ?? 0.004, o.send ?? 0));
        osc.start(t0);
        osc.stop(t0 + o.dur + 0.02);
    }

    private noiseHit(o: NoiseOpts) {
        const t0 = this.at(o.t);
        const src = this.ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        const filter = this.ctx.createBiquadFilter();
        filter.type = o.filter;
        filter.Q.value = o.q ?? 0.8;
        filter.frequency.setValueAtTime(o.f, t0);
        if (o.f2) filter.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.dur);
        src.connect(filter).connect(this.voice(t0, o.dur, o.gain, o.attack ?? 0.003, o.send ?? 0));
        // A random offset keeps repeated hits from sounding like one sample.
        src.start(t0, Math.random() * 1.5);
        src.stop(t0 + o.dur + 0.02);
    }

    /** Two-operator FM bell: bright at the strike, pure as it rings out. */
    private bell(o: BellOpts) {
        const t0 = this.at(o.t);
        const carrier = this.ctx.createOscillator();
        carrier.frequency.value = o.f;
        const mod = this.ctx.createOscillator();
        mod.frequency.value = o.f * (o.ratio ?? 3.5);
        const depth = this.ctx.createGain();
        depth.gain.setValueAtTime(o.f * (o.index ?? 1.6), t0);
        depth.gain.exponentialRampToValueAtTime(0.01, t0 + o.dur * 0.55);
        mod.connect(depth).connect(carrier.frequency);
        carrier.connect(this.voice(t0, o.dur, o.gain, 0.002, o.send ?? 0.3));
        carrier.start(t0);
        mod.start(t0);
        carrier.stop(t0 + o.dur + 0.02);
        mod.stop(t0 + o.dur + 0.02);
    }

    /** Detuned saws through a closing lowpass: the brassy chord under a big hit. */
    private stab(notes: number[], t: number, dur: number, gain: number, bright: number) {
        const t0 = this.at(t);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 1.2;
        filter.frequency.setValueAtTime(500, t0);
        filter.frequency.exponentialRampToValueAtTime(bright, t0 + 0.05);
        filter.frequency.exponentialRampToValueAtTime(420, t0 + dur);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
        g.gain.setValueAtTime(gain, t0 + dur * 0.45);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        filter.connect(g);
        g.connect(this.bus);
        const s = this.ctx.createGain();
        s.gain.value = 0.35;
        g.connect(s).connect(this.send);
        for (const f of notes) {
            for (const detune of [-9, 9]) {
                const osc = this.ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.value = f;
                osc.detune.value = detune;
                const each = this.ctx.createGain();
                each.gain.value = 1 / (notes.length * 2);
                osc.connect(each).connect(filter);
                osc.start(t0);
                osc.stop(t0 + dur + 0.05);
            }
        }
    }

    /**
     * The weight under an impact. A phone speaker cannot reproduce the
     * fundamental (it rolls off below a few hundred Hz), so a triangle two
     * octaves up carries the same drop where it can actually be heard.
     */
    private subDrop(t: number, from: number, to: number, dur: number, gain: number) {
        this.tone({ f: from, f2: to, t, dur, gain, attack: 0.006 });
        this.tone({ f: from * 4, f2: to * 4, t, dur: dur * 0.55, gain: gain * 0.3, type: 'triangle', attack: 0.004 });
    }

    private arp(notes: number[], t: number, step: number, gain: number, dur = 0.7, send = 0.4) {
        notes.forEach((f, i) => this.bell({ f, t: t + i * step, dur, gain, send }));
    }

    /** A scatter of high pings: the glitter that hangs after a hit. */
    private shimmer(t: number, count: number, span: number, gain: number) {
        const scale = [N.C6, N.D6, N.E6, N.G6, N.A6, N.C7, N.E7];
        for (let i = 0; i < count; i++) {
            this.bell({
                f: scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 2 : 1),
                t: t + Math.random() * span,
                dur: 0.35 + Math.random() * 0.4,
                gain: gain * (0.5 + Math.random() * 0.5),
                ratio: 2,
                index: 0.8,
                send: 0.55,
            });
        }
    }

    // ── Interface sounds ────────────────────────────────────────────────────

    tap() {
        this.tone({ f: 920, f2: 640, dur: 0.05, gain: 0.34 });
        this.noiseHit({ dur: 0.014, gain: 0.14, filter: 'highpass', f: 5000 });
    }

    /** Carousel moved one pack. `up` picks the direction of the whoosh. */
    swipe(up: boolean) {
        this.crackle({ dur: 0.17, gain: 1.1, rate: up ? 0.9 : 1.3, rate2: up ? 1.3 : 0.9 });
        this.crackle({ tear: true, dur: 0.13, gain: 0.2, rate: up ? 0.5 : 0.8, rate2: up ? 0.8 : 0.5, attack: 0.03 });
        this.noiseHit({ dur: 0.15, gain: 0.14, filter: 'bandpass', f: up ? 700 : 2400, f2: up ? 2600 : 700, q: 1.4 });
    }

    sheet(open: boolean) {
        this.noiseHit({ dur: 0.2, gain: 0.4, filter: 'lowpass', f: open ? 500 : 2200, f2: open ? 2200 : 500 });
    }

    deny() {
        for (const t of [0, 0.11]) {
            this.tone({ f: 156, t, dur: 0.085, gain: 0.16, type: 'square' });
            this.tone({ f: 104, t, dur: 0.085, gain: 0.14, type: 'triangle' });
        }
    }

    /** Purchase confirmed: a thump with a rising two-note answer. */
    buy() {
        this.subDrop(0, 120, 62, 0.16, 0.45);
        this.tone({ f: 523, f2: 784, dur: 0.07, gain: 0.13 });
        this.tone({ f: 784, f2: 1047, t: 0.075, dur: 0.11, gain: 0.13, send: 0.2 });
    }

    // ── The rip ─────────────────────────────────────────────────────────────

    /** The sealed pack is set down: foil rustles, then a soft landing. */
    packIn() {
        this.crackle({ dur: 0.3, gain: 1.1, rate: 1.15, rate2: 0.8, attack: 0.04 });
        this.crackle({ tear: true, dur: 0.24, gain: 0.16, rate: 0.55, attack: 0.05 });
        this.noiseHit({ dur: 0.3, gain: 0.1, filter: 'lowpass', f: 3600, f2: 420 });
        this.tone({ f: 160, f2: 84, t: 0.26, dur: 0.11, gain: 0.3, type: 'triangle' });
        this.tone({ f: 96, f2: 58, t: 0.26, dur: 0.16, gain: 0.3 });
        this.crackle({ t: 0.27, dur: 0.16, gain: 0.9, rate: 0.85 });
    }

    /**
     * The tear along the top of the pack. Dense crackle follows the finger:
     * louder and higher the faster it moves, silent when it stops, with the
     * looser crinkle of the pack being held underneath.
     */
    tearStart(): TearHandle {
        const ctx = this.ctx;
        const t0 = this.at();
        const out = ctx.createGain();
        out.connect(this.bus);
        const wet = ctx.createGain();
        wet.gain.value = 0.1;
        out.connect(wet).connect(this.send);
        const film = this.foil(out);

        const tear = ctx.createBufferSource();
        tear.buffer = this.tearBuf;
        tear.loop = true;
        const tearGain = ctx.createGain();
        tearGain.gain.value = 0.0001;
        tear.connect(tearGain).connect(film);

        const crinkle = ctx.createBufferSource();
        crinkle.buffer = this.crinkleBuf;
        crinkle.loop = true;
        const crinkleGain = ctx.createGain();
        crinkleGain.gain.value = 0.0001;
        crinkle.connect(crinkleGain).connect(film);

        tear.start(t0, Math.random() * 2);
        crinkle.start(t0, Math.random() * 2);
        let ended = false;

        return {
            move: (progress, speed) => {
                if (ended) return;
                const now = ctx.currentTime;
                const p = Math.min(1, Math.max(0, progress));
                const v = Math.min(1, Math.max(0, speed));
                tearGain.gain.setTargetAtTime(v * 0.4, now, 0.018);
                // A faster pull snaps faster and brighter; the pitch also
                // creeps up as the strip shortens.
                tear.playbackRate.setTargetAtTime(0.7 + v * 0.85 + p * 0.25, now, 0.03);
                crinkleGain.gain.setTargetAtTime(0.2 + v * 0.5, now, 0.04);
            },
            end: () => {
                if (ended) return;
                ended = true;
                const now = ctx.currentTime;
                tearGain.gain.setTargetAtTime(0.0001, now, 0.02);
                crinkleGain.gain.setTargetAtTime(0.0001, now, 0.03);
                tear.stop(now + 0.2);
                crinkle.stop(now + 0.2);
            },
        };
    }

    /**
     * The strip comes away: a last hard snap, the puff of air out of the
     * pack, the loose foil fluttering off, and a glint for the light inside.
     */
    burst() {
        this.crackle({ tear: true, dur: 0.085, gain: 1.1, rate: 1.6, rate2: 1.1 });
        this.noiseHit({ t: 0.02, dur: 0.17, gain: 0.4, filter: 'lowpass', f: 620, f2: 170 });
        this.noiseHit({ t: 0.02, dur: 0.1, gain: 0.24, filter: 'bandpass', f: 950, q: 0.7 });
        this.subDrop(0.02, 132, 54, 0.3, 0.4);
        this.crackle({ t: 0.05, dur: 0.42, gain: 1, rate: 1.25, rate2: 0.7, send: 0.2 });
        this.crackle({ tear: true, t: 0.05, dur: 0.2, gain: 0.25, rate: 0.9, rate2: 0.5, send: 0.2 });
        this.arp([N.E6, N.G6, N.C7], 0.09, 0.05, 0.05, 0.5, 0.6);
    }

    /** The slab slides up out of the foil and clears it. */
    rise() {
        this.crackle({ tear: true, dur: 0.36, gain: 0.3, rate: 0.5, rate2: 0.75, attack: 0.07 });
        this.noiseHit({ dur: 0.45, gain: 0.13, filter: 'bandpass', f: 380, f2: 2300, q: 1.1, attack: 0.12, send: 0.3 });
        this.slabTap(0.45, 0.4);
    }

    /** The slab turning over: a short rush of air before it lands. */
    flip() {
        this.noiseHit({ dur: 0.21, gain: 0.48, filter: 'bandpass', f: 480, f2: 3000, q: 1.2, attack: 0.1 });
    }

    /**
     * The build-up under a face-down slab. Rises in pitch, brightness and
     * flutter for `seconds`, then is cut dead by stop() an instant before the
     * reveal, so the hit lands out of silence.
     */
    chargeStart(seconds: number): ChargeHandle {
        const ctx = this.ctx;
        const t0 = this.at();
        const end = t0 + seconds;

        const out = ctx.createGain();
        // Audible from the first beat, then a steady climb: an exponential
        // ramp from silence would sit near zero until the last moment.
        out.gain.setValueAtTime(0.0001, t0);
        out.gain.linearRampToValueAtTime(0.06, t0 + Math.min(0.2, seconds / 3));
        out.gain.linearRampToValueAtTime(0.17, end);
        out.connect(this.bus);
        const outSend = ctx.createGain();
        outSend.gain.value = 0.3;
        out.connect(outSend).connect(this.send);

        // Flutter that speeds up: 5 Hz at the start, 19 Hz by the end.
        const trem = ctx.createGain();
        trem.gain.value = 0.7;
        const lfo = ctx.createOscillator();
        lfo.frequency.setValueAtTime(5, t0);
        lfo.frequency.exponentialRampToValueAtTime(19, end);
        const lfoDepth = ctx.createGain();
        lfoDepth.gain.value = 0.3;
        lfo.connect(lfoDepth).connect(trem.gain);
        trem.connect(out);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 3;
        filter.frequency.setValueAtTime(260, t0);
        filter.frequency.exponentialRampToValueAtTime(5200, end);
        filter.connect(trem);

        const oscs: OscillatorNode[] = [lfo];
        for (const detune of [-12, 0, 12]) {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.detune.value = detune;
            osc.frequency.setValueAtTime(N.C3 / 2, t0);
            osc.frequency.exponentialRampToValueAtTime(N.C4, end);
            const each = ctx.createGain();
            each.gain.value = 0.33;
            osc.connect(each).connect(filter);
            oscs.push(osc);
        }

        const air = ctx.createBufferSource();
        air.buffer = this.noise;
        air.loop = true;
        const airFilter = ctx.createBiquadFilter();
        airFilter.type = 'bandpass';
        airFilter.Q.value = 1.6;
        airFilter.frequency.setValueAtTime(400, t0);
        airFilter.frequency.exponentialRampToValueAtTime(6000, end);
        const airGain = ctx.createGain();
        airGain.gain.value = 0.5;
        air.connect(airFilter).connect(airGain).connect(trem);

        for (const o of oscs) o.start(t0);
        air.start(t0);
        let stopped = false;
        const stopAt = (when: number) => {
            for (const o of oscs) o.stop(when);
            air.stop(when);
        };
        // Safety net: a riser whose stop() is never called still ends.
        stopAt(end + 4);

        return {
            stop: () => {
                if (stopped) return;
                stopped = true;
                const now = ctx.currentTime;
                out.gain.cancelScheduledValues(now);
                out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), now);
                out.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
                stopAt(now + 0.06);
            },
        };
    }

    /** The tell climbs a class: one rising note per step (0-based). */
    escalate(step: number) {
        const notes = [N.E5, N.G5, N.B5, N.D6, N.G6];
        const f = notes[Math.min(step, notes.length - 1)];
        this.tone({ f: f / 2, f2: f, dur: 0.1, gain: 0.16 });
        this.bell({ f, t: 0.02, dur: 0.6, gain: 0.22 + step * 0.02, send: 0.45 });
        this.noiseHit({ dur: 0.16, gain: 0.1 + step * 0.02, filter: 'bandpass', f: 1500, f2: 5200 + step * 600, q: 1.2 });
    }

    /**
     * The slab turns face-up. `rank` is the hit class, 0 (D) to 5 (SS); each
     * step up adds weight, harmony and tail rather than just volume.
     */
    reveal(rank: number) {
        // Whatever the class, the first thing heard is the slab itself
        // snapping face-up. What follows is how good it is.
        this.slabTap(0.75 + rank * 0.07);
        if (rank <= 0) {
            this.subDrop(0, 140, 70, 0.2, 0.42);
            this.bell({ f: N.C5, t: 0.03, dur: 0.45, gain: 0.07, ratio: 2, send: 0.3 });
            return;
        }
        if (rank === 1) {
            this.subDrop(0, 150, 66, 0.24, 0.5);
            this.arp([N.C5, N.G5], 0.03, 0.07, 0.12, 0.6, 0.35);
            return;
        }
        if (rank === 2) {
            this.subDrop(0, 165, 52, 0.38, 0.72);
            this.noiseHit({ dur: 0.32, gain: 0.16, filter: 'bandpass', f: 2200, f2: 700, q: 0.6, send: 0.4 });
            this.arp([N.C5, N.E5, N.G5, N.C6], 0.01, 0.055, 0.15, 0.75);
            this.shimmer(0.2, 5, 0.5, 0.05);
            return;
        }
        if (rank === 3) {
            this.subDrop(0, 172, 44, 0.52, 0.88);
            this.noiseHit({ dur: 0.55, gain: 0.2, filter: 'bandpass', f: 2600, f2: 600, q: 0.5, send: 0.5 });
            this.stab([N.C4, N.E4, N.G4, N.B4, N.D5], 0, 0.95, 0.2, 3600);
            this.arp([N.C5, N.E5, N.G5, N.B5, N.D6, N.E6], 0.02, 0.05, 0.15, 0.9);
            this.shimmer(0.25, 9, 0.9, 0.055);
            return;
        }
        if (rank === 4) {
            this.subDrop(0, 190, 36, 0.9, 1);
            this.noiseHit({ dur: 0.95, gain: 0.24, filter: 'bandpass', f: 3200, f2: 500, q: 0.45, send: 0.6 });
            this.stab([N.C3, N.G3, N.C4, N.E4, N.G4, N.C5], 0, 1.7, 0.26, 4600);
            this.arp([N.G5, N.C6, N.E6, N.G6], 0.03, 0.09, 0.17, 1.1, 0.5);
            this.bell({ f: N.C7, t: 0.42, dur: 1.4, gain: 0.12, ratio: 2, send: 0.6 });
            this.shimmer(0.3, 18, 1.7, 0.06);
            return;
        }
        // SS: the S hit, then the chord climbs two whole steps (C, D, E) with
        // an arpeggio on each. A rising key is the oldest "you won" in games.
        this.subDrop(0, 200, 34, 1.1, 1);
        this.noiseHit({ dur: 1.2, gain: 0.26, filter: 'bandpass', f: 3600, f2: 450, q: 0.4, send: 0.65 });
        this.stab([N.C3, N.G3, N.C4, N.E4, N.G4, N.C5], 0, 0.62, 0.26, 4600);
        this.arp([N.C5, N.E5, N.G5, N.C6], 0.02, 0.07, 0.16, 0.8, 0.5);
        this.stab([N.D3, N.A3, N.D4, N.Fs4, N.A4, N.D5], 0.56, 0.62, 0.27, 5000);
        this.arp([N.D5, N.Fs5, N.A5, N.D6], 0.58, 0.07, 0.17, 0.8, 0.5);
        this.subDrop(1.12, 170, 40, 0.8, 0.8);
        this.stab([N.E3, N.B3, N.E4, N.Gs4, N.B4, N.E5], 1.12, 2.3, 0.3, 5600);
        this.arp([N.E5, N.Gs5, N.B5, N.E6, N.B6], 1.14, 0.075, 0.18, 1.4, 0.6);
        this.bell({ f: N.E7, t: 1.6, dur: 2, gain: 0.13, ratio: 2, send: 0.7 });
        this.shimmer(0.3, 34, 3.2, 0.06);
    }

    /** The class badge slams onto the slab. */
    stamp() {
        this.noiseHit({ dur: 0.07, gain: 0.34, filter: 'lowpass', f: 760 });
        this.subDrop(0, 104, 58, 0.13, 0.55);
    }

    /** One tick of the value counter; `p` 0..1 raises the pitch as it climbs. */
    tick(p: number) {
        this.tone({ f: 1100 + 900 * Math.min(1, Math.max(0, p)), dur: 0.026, gain: 0.2 });
    }

    /** The counter lands on the slab's value. */
    countDone(rank: number) {
        this.bell({ f: N.C6, dur: 0.6, gain: 0.12, ratio: 2, send: 0.4 });
        if (rank >= 2) this.bell({ f: N.G6, t: 0.06, dur: 0.7, gain: 0.1, ratio: 2, send: 0.45 });
    }

    // ── After the reveal ────────────────────────────────────────────────────

    /** Sold back: the till opens and a handful of coins lands, quickening. */
    coins() {
        this.noiseHit({ dur: 0.03, gain: 0.2, filter: 'highpass', f: 6200 });
        this.bell({ f: N.C7, t: 0.02, dur: 0.45, gain: 0.1, ratio: 2.76, index: 2, send: 0.35 });
        let t = 0.09;
        for (let i = 0; i < 7; i++) {
            this.coin(t, 0.1 - i * 0.006);
            t += 0.085 * Math.pow(0.86, i) + Math.random() * 0.012;
        }
    }

    /** Kept: the slab is set down in the vault and the drawer shuts. */
    keep() {
        this.slabTap(0.9);
        this.tone({ f: 175, f2: 96, t: 0.07, dur: 0.15, gain: 0.28, type: 'triangle' });
        this.tone({ f: 88, f2: 52, t: 0.07, dur: 0.18, gain: 0.26 });
        this.noiseHit({ t: 0.16, dur: 0.02, gain: 0.16, filter: 'bandpass', f: 2400, q: 2 });
    }

    /** Leaving the stage. */
    whooshOut() {
        this.noiseHit({ dur: 0.26, gain: 0.36, filter: 'bandpass', f: 2600, f2: 420, q: 1 });
    }
}

// ── Singleton the UI talks to ───────────────────────────────────────────────

type AudioCtor = typeof AudioContext;

let kit: SfxKit | null = null;
let enabled = true;

function ready(): SfxKit | null {
    if (!enabled || !kit) return null;
    return kit.ctx.state === 'running' ? kit : null;
}

/** Wrap a kit method so it is a no-op while sound is off or still locked. */
function safe<A extends unknown[]>(call: (k: SfxKit, ...args: A) => void) {
    return (...args: A) => {
        const k = ready();
        if (!k) return;
        try {
            call(k, ...args);
        } catch {
            // A sound must never take the rip down with it.
        }
    };
}

const NO_TEAR: TearHandle = { move: () => {}, end: () => {} };
const NO_CHARGE: ChargeHandle = { stop: () => {} };

export const sfx = {
    /**
     * Start (or resume) audio. Must run inside a user gesture; call it from
     * the first pointerdown. Safe to call on every tap.
     */
    unlock() {
        if (typeof window === 'undefined') return;
        try {
            if (!kit) {
                const Ctor: AudioCtor | undefined =
                    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
                if (!Ctor) return;
                kit = new SfxKit(new Ctor({ latencyHint: 'interactive' }));
            }
            const ctx = kit.ctx as AudioContext;
            if (ctx.state !== 'running') void ctx.resume();
        } catch {
            kit = null;
        }
    },
    setEnabled(on: boolean) {
        enabled = on;
    },
    tap: safe((k) => k.tap()),
    swipe: safe((k, up: boolean) => k.swipe(up)),
    sheet: safe((k, open: boolean) => k.sheet(open)),
    deny: safe((k) => k.deny()),
    buy: safe((k) => k.buy()),
    packIn: safe((k) => k.packIn()),
    burst: safe((k) => k.burst()),
    rise: safe((k) => k.rise()),
    flip: safe((k) => k.flip()),
    slabTap: safe((k, strength: number) => k.slabTap(strength)),
    escalate: safe((k, step: number) => k.escalate(step)),
    reveal: safe((k, rank: number) => k.reveal(rank)),
    stamp: safe((k) => k.stamp()),
    tick: safe((k, p: number) => k.tick(p)),
    countDone: safe((k, rank: number) => k.countDone(rank)),
    coins: safe((k) => k.coins()),
    keep: safe((k) => k.keep()),
    whooshOut: safe((k) => k.whooshOut()),
    tearStart(): TearHandle {
        const k = ready();
        if (!k) return NO_TEAR;
        try {
            return k.tearStart();
        } catch {
            return NO_TEAR;
        }
    },
    chargeStart(seconds: number): ChargeHandle {
        const k = ready();
        if (!k) return NO_CHARGE;
        try {
            return k.chargeStart(seconds);
        } catch {
            return NO_CHARGE;
        }
    },
    /**
     * A whole rip without a finger, for the sound check: a half-second pull
     * that starts slow, speeds up and breaks through.
     */
    playRip() {
        const tear = sfx.tearStart();
        const steps = 22;
        for (let i = 0; i <= steps; i++) {
            const p = i / steps;
            setTimeout(() => tear.move(p, 0.25 + 0.75 * Math.sin(p * Math.PI * 0.85)), p * 460);
        }
        setTimeout(() => {
            tear.end();
            sfx.burst();
        }, 480);
    },
    /** The tell climbing all the way, then the flip, for the sound check. */
    playTell(rank: number) {
        const seconds = (520 + rank * 430 + 300) / 1000;
        const charge = sfx.chargeStart(seconds);
        for (let k = 1; k <= rank; k++) setTimeout(() => sfx.escalate(k - 1), 520 + (k - 1) * 430);
        setTimeout(() => {
            charge.stop();
            sfx.flip();
        }, seconds * 1000);
        setTimeout(() => sfx.reveal(rank), seconds * 1000 + 290);
    },
};
