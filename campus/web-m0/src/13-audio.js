/*
 * 13-audio.js —— 程序化音效（WebAudio，不用任何素材）
 * 只做一件事：把「听觉组件算出来的 margin 和方向」变成耳朵能感知的东西。
 * 音量来自 margin，声像来自路径入口方向 —— 所以你在游戏里听到的，
 * 就是规则层算出来的，两者不会各说各话。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  const Audio = {
    ctx: null, master: null, enabled: false,
    init() {
      if (this.ctx) return;
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.enabled = true;
      this._noise = this._makeNoise();
    },
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    _makeNoise() {
      const len = this.ctx.sampleRate * 0.5;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    },
    _voice(gain, pan) {
      const g = this.ctx.createGain();
      const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      g.gain.value = 0;
      if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(this.master); }
      else g.connect(this.master);
      return g;
    },
    /** category → 一段合成音 */
    play(category, gain, pan) {
      if (!this.enabled || gain <= 0.001) return;
      const t = this.ctx.currentTime, g = this._voice(gain, pan);
      const spec = {
        Footstep: { type: 'noise', f: 900, q: 1.2, dur: 0.09, atk: 0.004 },
        Door:     { type: 'noise', f: 420, q: 3.0, dur: 0.35, atk: 0.01 },
        Impact:   { type: 'noise', f: 240, q: 1.0, dur: 0.22, atk: 0.002 },
        Ambient:  { type: 'noise', f: 600, q: 0.7, dur: 0.55, atk: 0.12 },
        Voice:    { type: 'tone',  f: 82,  dur: 0.9,  atk: 0.06 },
        Gunshot:  { type: 'noise', f: 1600, q: 0.6, dur: 0.4, atk: 0.001 }
      }[category] || { type: 'noise', f: 500, q: 1, dur: 0.15, atk: 0.005 };

      if (spec.type === 'noise') {
        const src = this.ctx.createBufferSource();
        src.buffer = this._noise;
        const flt = this.ctx.createBiquadFilter();
        flt.type = 'bandpass'; flt.frequency.value = spec.f; flt.Q.value = spec.q;
        src.connect(flt); flt.connect(g);
        src.start(t); src.stop(t + spec.dur + 0.05);
      } else {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth'; osc.frequency.value = spec.f;
        const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
        lfo.frequency.value = 5.5; lg.gain.value = 7;
        lfo.connect(lg); lg.connect(osc.frequency);
        const flt = this.ctx.createBiquadFilter();
        flt.type = 'lowpass'; flt.frequency.value = 700;
        osc.connect(flt); flt.connect(g);
        osc.start(t); lfo.start(t);
        osc.stop(t + spec.dur + 0.05); lfo.stop(t + spec.dur + 0.05);
      }
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + spec.atk);
      g.gain.exponentialRampToValueAtTime(0.0008, t + spec.dur);
    },

    /** 玩家听到别人发出的声音：音量 ∝ margin，声像 ∝ 路径入口方向 */
    onHeard(info, player) {
      if (!this.enabled) return;
      const gain = Math.min(1, info.margin / 45) * 0.85;
      const right = { x: Math.cos(player.yaw), z: -Math.sin(player.yaw) };
      const pan = info.dir.x * right.x + info.dir.z * right.z;
      this.play(info.evt.category, gain, pan);
    },
    /** 玩家自己发出的声音：固定小音量，居中 */
    onSelf(evt) {
      if (!this.enabled) return;
      const g = evt.category === 'Footstep' ? 0.10 : 0.22;
      this.play(evt.category, g, 0);
    }
  };

  C.Audio = Audio;
})(typeof globalThis !== 'undefined' ? globalThis : this);
