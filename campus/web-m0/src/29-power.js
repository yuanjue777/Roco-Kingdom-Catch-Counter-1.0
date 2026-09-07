/*
 * 29-power.js —— 供电（烹饪与供电规格 第二部分）
 *
 * **第 2 层（规则层）。它不知道厨房的存在**，只回答两个问题：
 *   ① 这条链路现在能不能供电？
 *   ② 当前用了多少瓦、还剩多少？
 * 烹饪系统可以向下查询它，反过来不行（规格 13.4）。
 *
 * 设计要点：**跳闸不是随机的，是玩家算错了。**
 * 所以界面必须始终能拿到「已用/上限」，而这个模块必须让它随时可查。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  /* ── 回路 ────────────────────────────────────────────
     每栋楼的电被分成若干回路。玩家在宿舍找到的第一个插座很可能是死的，
     他必须去找配电间 —— 这就把「探索这栋楼」变成一个具体的、有回报的目标。 */
  const CircuitState = { Live: 'live', BreakerOff: 'off', Damaged: 'damaged', Dead: 'dead' };

  function Circuit(id, name, opts) {
    opts = opts || {};
    this.id = id;
    this.name = name;
    this.breakerOn = opts.breakerOn !== false;
    this.wiringDamaged = !!opts.damaged;
    this.permanentlyDead = !!opts.dead;
    this.maxWatt = opts.maxWatt || C.Config.power.sources.grid.watt;
    this.panelAt = opts.panelAt || null;      // 配电箱在哪（世界坐标）
  }
  Circuit.prototype.state = function () {
    if (this.permanentlyDead) return CircuitState.Dead;
    if (this.wiringDamaged) return CircuitState.Damaged;
    if (!this.breakerOn) return CircuitState.BreakerOff;
    return CircuitState.Live;
  };
  Circuit.prototype.canDeliver = function (gridUp) {
    return gridUp && this.state() === CircuitState.Live;
  };

  /* ── 电源实例 ───────────────────────────────────────
     grid 是全局的（第 11 天 00:00 永久中断）；其余是玩家搬来的物件。 */
  function Source(kind, opts) {
    opts = opts || {};
    const def = C.Config.power.sources[kind];
    this.kind = kind;
    this.name = def.name;
    this.maxWatt = def.watt;
    this.fuelType = def.fuel;
    this.perHour = def.perHour;
    this.loud = def.loud;
    this.on = kind === 'grid';
    this.fuel = opts.fuel !== undefined ? opts.fuel : 0;   // 柴油升 / 电瓶 Wh
    this.pos = opts.pos || null;
    this.circuitId = opts.circuitId || null;               // grid 专用
    this.solarPanels = opts.solarPanels || 0;
  }

  /** 这个电源此刻实际能输出多少瓦（0 = 供不上） */
  Source.prototype.available = function (env) {
    if (this.kind === 'grid') {
      const c = env.circuits.get(this.circuitId);
      return (c && c.canDeliver(env.gridUp)) ? Math.min(this.maxWatt, c.maxWatt) : 0;
    }
    if (!this.on) return 0;
    if (this.kind === 'solar') return this.solarPanels * solarWatt(env);
    if (this.fuelType === 'diesel') return this.fuel > 0 ? this.maxWatt : 0;
    if (this.fuelType === 'charge') return this.fuel > 0 ? this.maxWatt : 0;
    return this.maxWatt;
  };

  /** 太阳能单块输出：**夜里是 0，这一点不能忘** */
  function solarWatt(env) {
    const S = C.Config.power.solarOutput;
    if (env.night) return S.night;
    if (env.weather === 'rain') return S.rain;
    if (env.weather === 'cloudy') return S.cloudy;
    return S.clearDay;
  }

  /* ── 链路 ────────────────────────────────────────────
     一条链路 = 电源 → (电线/插线板)×N → 设备。
     长度累加，**按世界空间距离判定**；插孔数是硬限制。 */
  function Link(id, source) {
    this.id = id;
    this.source = source;
    this.cables = [];          // cable kind 的数组，有序
    this.devices = [];         // { id, watt, on, label }
    this.tripped = false;
  }
  Link.prototype.metres = function () {
    let m = 0;
    for (const k of this.cables) m += C.Config.power.cables[k].metres;
    return m;
  };
  Link.prototype.sockets = function () {
    // 插线板可以串联，插孔数累加；但每接一段线要占掉上一段的一个孔
    let n = 0;
    for (let i = 0; i < this.cables.length; i++) {
      n += C.Config.power.cables[this.cables[i]].sockets;
      if (i > 0) n -= 1;
    }
    return n;
  };
  Link.prototype.watt = function () {
    let w = 0;
    for (const d of this.devices) if (d.on) w += d.watt;
    return w;
  };
  Link.prototype.reachable = function (from, to) {
    return C.V.dist(from, to) <= this.metres();
  };

  /* ── 系统 ──────────────────────────────────────────── */
  const Power = {
    circuits: new Map(),
    sources: [],
    links: [],
    gridUp: true,
    weather: 'clear',
    night: false,
    _nextLink: 1,

    reset(level) {
      this.circuits = new Map();
      this.sources = [];
      this.links = [];
      this.gridUp = true;
      this._nextLink = 1;
      if (level && level.circuits) {
        for (const r of level.circuits) {
          const c = this.addCircuit(r.id, r.name, { breakerOn: r.breakerOn, panelAt: r.panelAt });
          c.buildingId = r.buildingId;
        }
      }
      return this;
    },

    env() { return { circuits: this.circuits, gridUp: this.gridUp, weather: this.weather, night: this.night }; },

    addCircuit(id, name, opts) {
      const c = new Circuit(id, name, opts);
      this.circuits.set(id, c);
      return c;
    },
    addSource(kind, opts) {
      const s = new Source(kind, opts);
      this.sources.push(s);
      return s;
    },
    createLink(source) {
      const l = new Link(this._nextLink++, source);
      this.links.push(l);
      return l;
    },

    /**
     * 推闸 / 拉闸。**产生响度 25 的 Impact** ——
     * 教学关卡里「先关上配电间的门再推闸」是二楼那堂关门课的考试。
     */
    setBreaker(circuitId, on, atPos, byId) {
      const c = this.circuits.get(circuitId);
      if (!c) return { ok: false, msg: '没有这个回路' };
      if (c.permanentlyDead) return { ok: false, msg: '主干线断了，这条回路救不回来' };
      c.breakerOn = !!on;
      if (atPos) {
        C.SoundSystem.emit({
          worldPosition: atPos, loudness: C.Config.power.breakerLoudness,
          category: C.SoundCategory.Impact, emitterId: byId === undefined ? -1 : byId,
          label: on ? '推上电闸' : '拉下电闸'
        });
      }
      C.EventBus.publish('BreakerChangedEvent', { circuitId, on: c.breakerOn });
      return { ok: true, msg: (on ? '推上了' : '拉下了') + c.name + '的闸' };
    },

    /** 修回路：需要 电线 ×2 + 工具，手艺 ≥ 2（规格 2.2） */
    repairCircuit(circuitId, craftLevel, hasParts) {
      const c = this.circuits.get(circuitId);
      if (!c) return { ok: false, msg: '没有这个回路' };
      if (c.permanentlyDead) return { ok: false, msg: '主干线断了，修不了' };
      if (!c.wiringDamaged) return { ok: false, msg: '这条回路没坏' };
      if (craftLevel < C.Config.power.repairSkillLevel) return { ok: false, msg: '手艺不够（需要 2 级）' };
      if (!hasParts) return { ok: false, msg: '需要 电线 ×2 和工具' };
      c.wiringDamaged = false;
      return { ok: true, msg: '接好了线' };
    },

    /**
     * 设备开关。**超载立即跳闸**，不是随机的 —— 玩家算错了。
     * @returns {ok, msg, tripped}
     */
    setDevice(link, deviceId, on) {
      const d = link.devices.find(x => x.id === deviceId);
      if (!d) return { ok: false, msg: '这条链路上没有这台设备' };
      if (on && link.tripped) return { ok: false, msg: '跳闸了，先复位' };
      const avail = link.source.available(this.env());
      if (on && avail <= 0) return { ok: false, msg: '这个插座没电' };
      d.on = !!on;
      if (on && link.watt() > avail) {
        this.trip(link, avail);
        return { ok: false, msg: '超载跳闸', tripped: true };
      }
      return { ok: true, msg: (on ? '打开了' : '关掉了') + (d.label || '设备') };
    },

    /** 跳闸：断电、发一次响度 40 的「啪」、广播出去让上层报废正在做的东西 */
    trip(link, avail) {
      link.tripped = true;
      for (const d of link.devices) d.on = false;
      const pos = link.source.pos;
      if (pos) {
        C.SoundSystem.emit({
          worldPosition: pos, loudness: C.Config.power.tripLoudness,
          category: C.SoundCategory.Impact, emitterId: -1, label: '跳闸'
        });
      }
      C.EventBus.publish('CircuitOverloadedEvent', { linkId: link.id, limit: avail });
    },

    resetBreakerOf(link) { link.tripped = false; return { ok: true, msg: '复位了' }; },

    /**
     * 每游戏小时推进：烧柴油、耗电瓶、到日子断市电。
     * @param dtHours 经过的游戏小时
     * @param day 当前天数
     */
    update(dtHours, day, night, weather) {
      this.night = !!night;
      if (weather) this.weather = weather;

      // **第 11 天 00:00 市电永久中断。** 前十天养成的习惯全部作废。
      if (this.gridUp && day >= C.Config.power.gridFailDay) {
        this.gridUp = false;
        for (const l of this.links) {
          if (l.source.kind !== 'grid') continue;
          for (const d of l.devices) d.on = false;
        }
        C.EventBus.publish('PowerLostEvent', { reason: 'gridFail', day });
      }
      if (dtHours <= 0) return;

      for (const l of this.links) {
        const w = l.watt();
        if (w <= 0) continue;
        const s = l.source;
        if (s.fuelType === 'diesel') {
          s.fuel = Math.max(0, s.fuel - s.perHour * dtHours);
          if (s.fuel <= 0) {
            for (const d of l.devices) d.on = false;
            s.on = false;
            C.EventBus.publish('PowerLostEvent', { reason: 'noFuel', linkId: l.id });
          }
        } else if (s.fuelType === 'charge') {
          // 电瓶按实际功率放电（Wh）
          s.fuel = Math.max(0, s.fuel - w * dtHours);
          if (s.fuel <= 0) {
            for (const d of l.devices) d.on = false;
            C.EventBus.publish('PowerLostEvent', { reason: 'batteryFlat', linkId: l.id });
          }
        }
      }
      // 发电机在运行时持续发出噪音（规格 10.1：**全游戏最持久的噪音源**）
      for (const s of this.sources) {
        if (!s.on || !s.pos || !s.loud) continue;
        if (s.fuelType === 'diesel' && s.fuel <= 0) continue;
        this._genNoise = (this._genNoise || 0) + dtHours;
      }
    },

    /** 发电机噪音由装配层按真实秒数驱动（每 2 秒一次，和设备运行噪音一致） */
    emitRunningNoise(dtSeconds) {
      this._noiseAcc = (this._noiseAcc || 0) + dtSeconds;
      if (this._noiseAcc < 2) return;
      this._noiseAcc = 0;
      for (const s of this.sources) {
        if (!s.on || !s.pos || !s.loud) continue;
        if (s.fuelType === 'diesel' && s.fuel <= 0) continue;
        const busy = this.links.some(l => l.source === s && l.watt() > 0);
        if (!busy && s.kind !== 'genBig' && s.kind !== 'genSmall') continue;
        C.SoundSystem.emit({
          worldPosition: s.pos, loudness: s.loud,
          category: C.SoundCategory.Ambient, emitterId: -1, label: s.name + '运行'
        });
      }
    },

    /** 界面要的那一块：已用 / 上限 / 剩余燃料 */
    readout(link) {
      const avail = link.source.available(this.env());
      const s = link.source;
      return {
        sourceName: s.name,
        used: link.watt(),
        limit: avail,
        tripped: link.tripped,
        metres: link.metres(),
        sockets: link.sockets(),
        fuel: s.fuelType === 'diesel' ? s.fuel : null,
        fuelHours: s.fuelType === 'diesel' && s.perHour > 0 ? s.fuel / s.perHour : null,
        devices: link.devices.map(d => ({ label: d.label, watt: d.watt, on: d.on }))
      };
    },

    serialize() {
      return {
        gridUp: this.gridUp,
        circuits: Array.from(this.circuits.values()).map(c => ({
          id: c.id, breakerOn: c.breakerOn, damaged: c.wiringDamaged, dead: c.permanentlyDead
        })),
        sources: this.sources.map(s => ({ kind: s.kind, on: s.on, fuel: s.fuel, panels: s.solarPanels,
                                          pos: s.pos ? C.V.copy(s.pos) : null, circuitId: s.circuitId })),
        links: this.links.map(l => ({ id: l.id, srcIndex: this.sources.indexOf(l.source),
                                      cables: l.cables.slice(), tripped: l.tripped,
                                      devices: l.devices.map(d => ({ id: d.id, watt: d.watt, on: d.on, label: d.label })) }))
      };
    },
    deserialize(d) {
      if (!d) return this;
      this.gridUp = d.gridUp !== false;
      for (const r of d.circuits || []) {
        const c = this.circuits.get(r.id);
        if (c) { c.breakerOn = r.breakerOn; c.wiringDamaged = r.damaged; c.permanentlyDead = r.dead; }
      }
      this.sources = (d.sources || []).map(r => {
        const s = new Source(r.kind, { fuel: r.fuel, pos: r.pos, circuitId: r.circuitId, solarPanels: r.panels });
        s.on = r.on; return s;
      });
      this.links = (d.links || []).map(r => {
        const l = new Link(r.id, this.sources[r.srcIndex]);
        l.cables = r.cables || []; l.tripped = r.tripped; l.devices = r.devices || [];
        return l;
      });
      this._nextLink = this.links.reduce((n, l) => Math.max(n, l.id + 1), 1);
      return this;
    }
  };

  C.CircuitState = CircuitState;
  C.Circuit = Circuit;
  C.PowerSource = Source;
  C.PowerLink = Link;
  C.Power = Power;
  C.solarWatt = solarWatt;
})(typeof globalThis !== 'undefined' ? globalThis : this);
