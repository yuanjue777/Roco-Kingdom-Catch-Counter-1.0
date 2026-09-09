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
        // 石头砸中是全场最重要的一次反馈：钝一点、长一点，才听得出「砸到了」
        Impact:   { type: 'noise', f: 190, q: 1.2, dur: 0.34, atk: 0.001 },
        Ambient:  { type: 'noise', f: 600, q: 0.7, dur: 0.55, atk: 0.12 },
        Voice:    { type: 'tone',  f: 82,  dur: 0.9,  atk: 0.06 },
        Gunshot:  { type: 'noise', f: 1600, q: 0.6, dur: 0.4, atk: 0.001 },
        /* 烧水的咕嘟：低频窄带噪声，长而闷。它每 2 秒响一次（见 30-cooking），
           所以单次不能太短，否则听起来是「滴答」不是「在烧」。 */
        Boil:     { type: 'noise', f: 240, q: 2.6, dur: 1.6, atk: 0.35 },
        // 水开的哨响：见下面的专门分支，这里只留一个兜底
        Whistle:  { type: 'tone',  f: 1500, dur: 1.2, atk: 0.02 }
      }[category] || { type: 'noise', f: 500, q: 1, dur: 0.15, atk: 0.005 };

      /* **水开了要能只靠耳朵判断出来。**
         所以哨声不走通用分支：升调的正弦 + 一点抖动，和游戏里其它任何声音都不像。
         这是玩家「人在别的房间，听见水开了」的唯一依据。 */
      if (category === 'Whistle') {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(900, t);
        osc.frequency.exponentialRampToValueAtTime(1750, t + 0.35);
        const vib = this.ctx.createOscillator(), vg = this.ctx.createGain();
        vib.frequency.value = 7.5; vg.gain.value = 26;
        vib.connect(vg); vg.connect(osc.frequency);
        osc.connect(g);
        osc.start(t); vib.start(t);
        osc.stop(t + 1.3); vib.stop(t + 1.3);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.05);
        g.gain.setValueAtTime(gain, t + 0.9);
        g.gain.exponentialRampToValueAtTime(0.0008, t + 1.25);
        return;
      }

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

    /**
     * 玩家听到别人发出的声音：音量来自 margin，声像来自路径入口方向。
     *
     * `[实测]` 映射曲线从线性改成开方。
     * 线性 (`margin/45`) 下，margin 5 只有满音量的 11% —— 几乎听不见。
     * 而 margin 5 在规则层的意思是「**你确实听见了**，只是很轻」：
     * 站在烧开的水壶边上（咕嘟声 15、阈值 8）算出来就是这个数，
     * 玩家却什么都听不到，于是以为音效没做。
     *
     * 人耳本来就是对数的。开方之后 margin 5 → 33%，margin 45 → 100%，
     * **「刚好听得见」和「就在耳边」之间才有可用的动态范围** ——
     * 这对蜷伏者呼吸（12）、远处脚步这些贴着阈值的声音同样重要，
     * 而它们正是这个游戏最该被听见的东西。
     */
    onHeard(info, player) {
      if (!this.enabled) return;
      const gain = Math.sqrt(Math.min(1, info.margin / 45)) * 0.85;
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
