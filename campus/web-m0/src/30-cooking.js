/*
 * 30-cooking.js —— 烹饪（烹饪与供电规格 第三~九、十二部分）
 *
 * **第 4 层（交互层）。可以向下查询电力系统，反过来不行。**
 *
 * 核心张力：**吃得好 vs 被听见。**
 *   爆炒最香、饱食度最高，但油锅滋啦声 45
 *   砂锅慢炖最省电最安静，但要 2 小时，而且你得守着
 *   高压锅最快，但泄压哨声 55，全楼都听得见
 *   微波炉最省事，但结束那声「叮」是 50
 * **做饭这件事本身，永远在暴露你的位置。**
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const { M } = C;

  const Phase = { Cooking: '烹饪中', Golden: '黄金窗口', Overcooked: '过火', Ruined: '报废' };

  /* ── 一套厨房 ────────────────────────────────────────
     四层结构（规格 3.1）：台面 ← 加热设备 ← 锅具 ← 食材+水，
     电源通过电线连到加热设备。**每一步都是世界中的物理操作，不是菜单选项。** */
  function Station(id, opts) {
    opts = opts || {};
    this.id = id;
    this.pos = opts.pos || null;
    this.surface = opts.surface || 'desk';   // 台面类型
    this.slots = opts.slots || 1;            // 这个台面能放几台设备
    this.heater = opts.heater || null;       // heater kind
    this.cookware = opts.cookware || null;   // cookware kind
    this.link = opts.link || null;           // PowerLink
    this.deviceId = opts.deviceId || null;   // 它在链路上的设备 id
    this.session = null;
  }

  /* ── 一次烹饪 ─────────────────────────────────────── */
  function Session(recipe, station, opts) {
    opts = opts || {};
    this.recipeId = recipe.id;
    this.stationId = station.id;
    this.seasonings = opts.seasonings || 0;
    this.startAt = opts.now;
    this.totalMinutes = opts.minutes;
    this.doneAt = opts.now + opts.minutes / 60;               // 游戏小时
    this.goldenEnd = this.doneAt + opts.goldenMinutes / 60;
    this.ruinAt = this.goldenEnd + opts.overcookMinutes / 60;
    this.phase = Phase.Cooking;
    this.venting = 0;                                          // 高压锅泄压剩余分钟
  }

  const Cooking = {
    stations: [],
    xp: 0,
    made: {},                 // recipeId -> 次数
    usedCookware: {},
    usedHeaters: {},
    odors: [],                // { nodeId, level, until }  —— 气味是区域性的临时修正
    _nextStation: 1,
    _modKeys: [],

    reset() {
      this.stations = [];
      this.xp = 0; this.made = {}; this.usedCookware = {}; this.usedHeaters = {};
      this.clearOdors();
      this._nextStation = 1;
      return this;
    },

    /* ── 熟练度（规格 12.2）────────────────────────────
       `baseLevel` 是「N 级起步」类特性给的**等级下限**。
       **只给等级，不给经验**（角色规格 1.5）—— 后厨师傅 3 级起步，
       但他的经验条还是 0，接下来的成长速率和常人完全一样。
       写成「直接送 950 点经验」的话，他会在做完两道新菜之后直接跳到 4 级。 */
    baseLevel: 0,
    level() {
      const L = C.Config.cookingSkill.levels;
      let lv = 0;
      for (let i = 0; i < L.length; i++) if (this.xp >= L[i].xp) lv = i;
      return Math.max(lv, this.baseLevel || 0);
    },
    levelDef() { return C.Config.cookingSkill.levels[this.level()]; },

    /** **只有尝试新东西才涨熟练度。** 反复做蛋炒饭不会让你变成大厨。 */
    _gainMakeXp(recipeId) {
      const S = C.Config.cookingSkill;
      const n = (this.made[recipeId] || 0);
      this.made[recipeId] = n + 1;
      let xp = n === 0 ? S.xpFirstTime : (S.xpRepeat[n - 1] !== undefined ? S.xpRepeat[n - 1] : 0);
      xp = C.ModifierPipeline.query('skill.cooking.xp_gain', xp, 0);                 // 学得快
      this.xp += xp;
      return xp;
    },

    /* ── 可做什么 ─────────────────────────────────────
       返回 {ok} 或 {ok:false, why} —— why 要能直接显示给玩家。 */
    canCook(recipe, station, have) {
      if (recipe.lv > this.level()) return { ok: false, why: '还不会做（需要烹饪 ' + recipe.lv + ' 级）' };

      // 不需要加热的（泡面、咸菜配粥、腌菜、手擀面）
      if (recipe.heater !== 'none') {
        if (!station.heater) return { ok: false, why: '没有加热设备' };
        const H = C.Config.cooking.heaters[station.heater];
        // 老火靓汤/高汤炖肉：**只能用不需要看火的低功率设备**
        if (recipe.heater === 'slowOnly' && !H.autoShutoff) {
          return { ok: false, why: '这道菜要炖几个小时，得用不用看火的设备' };
        }
        if (H.needsCookware) {
          if (!station.cookware) return { ok: false, why: '这台设备要配一口锅' };
          const list = C.Config.cooking.compat[station.heater] || [];
          if (list.indexOf(station.cookware) < 0) {
            // **电磁炉配砂锅是玩家最容易犯的错误。** 无害但印象深刻。
            return { ok: false, why: '锅具不兼容：' +
              C.Config.cooking.cookware[station.cookware].name + '不能上' + H.name };
          }
        }
        if (recipe.pot && recipe.pot.length) {
          const tags = station.cookware ? C.Config.cooking.cookware[station.cookware].tags
                     : (H.needsCookware ? [] : ['boil']);           // 自带内胆的按「煮」算
          if (!recipe.pot.some(t => tags.indexOf(t) >= 0)) {
            return { ok: false, why: '这口锅做不了这道菜' };
          }
        }
        // 电：接了链路就得供得上
        if (H.watt > 0) {
          if (!station.link) return { ok: false, why: '没接电' };
          const r = C.Power.readout(station.link);
          if (r.tripped) return { ok: false, why: '跳闸了，先复位' };
          if (r.limit <= 0) return { ok: false, why: '这个插座没电' };
          /* **别把自己算两遍**：这台设备可能已经开着（上一锅还没关火）。
             算余量时要先把它自己的功率从「已用」里刨掉，
             否则第二次开火会被自己挡住，报一个看不懂的「功率不够」。 */
          const self = station.link.devices.find(d => d.id === station.deviceId);
          const usedByOthers = r.used - (self && self.on ? self.watt : 0);
          if (usedByOthers + H.watt > r.limit) {
            return { ok: false, why: '功率不够：还要 ' + H.watt + 'W，只剩 ' +
                     (r.limit - usedByOthers) + 'W' };
          }
        }
      }
      if (have) {
        for (const k in recipe.need) {
          if ((have[k] || 0) < recipe.need[k]) return { ok: false, why: '缺' + k };
        }
      }
      return { ok: true };
    },

    /** 实际时长 = 基准 × 设备系数 × 锅具系数 × 熟练度系数 */
    minutesFor(recipe, station) {
      let m = recipe.time;
      if (station.heater) m *= C.Config.cooking.heaters[station.heater].speed;
      if (station.cookware) {
        const cw = C.Config.cooking.cookware[station.cookware];
        if (cw.timeMul) m *= cw.timeMul;
      }
      const lv = this.levelDef();
      if (lv.timeMul) m *= lv.timeMul;
      return m;
    },

    /* ── 开火 ─────────────────────────────────────────── */
    start(recipeId, station, nowHours, opts) {
      opts = opts || {};
      const recipe = C.Config.recipes.find(r => r.id === recipeId);
      if (!recipe) return { ok: false, msg: '没有这个食谱' };
      const chk = this.canCook(recipe, station, opts.have);
      if (!chk.ok) return { ok: false, msg: chk.why };

      const minutes = this.minutesFor(recipe, station);
      const K = C.Config.cooking;
      let goldenMul = K.goldenWindowRatio;
      const lv = this.levelDef();
      if (lv.goldenWindowMul) goldenMul *= lv.goldenWindowMul;
      goldenMul = C.ModifierPipeline.query('cooking.golden_window', goldenMul, 0);   // 掌勺 / 厨房杀手

      const seasonings = Math.min(opts.seasonings || 0, K.seasoningMaxSlots);
      station.session = new Session(recipe, station, {
        now: nowHours, minutes,
        goldenMinutes: minutes * goldenMul,
        overcookMinutes: minutes * K.overcookRatio,
        seasonings
      });
      // 自动断电的设备不进过火期（规格 9.2）
      const H = station.heater ? K.heaters[station.heater] : null;
      station.session.autoShutoff = !H || H.autoShutoff;

      if (H && H.watt > 0 && station.link) {
        C.Power.setDevice(station.link, station.deviceId, true);
      }
      C.EventBus.publish('CookingStartedEvent', { recipeId, stationId: station.id });
      return { ok: true, msg: '开始做' + recipe.name + '（约 ' + minutes.toFixed(0) + ' 分钟）',
               minutes, session: station.session };
    },

    /* ── 每游戏小时推进 ─────────────────────────────── */
    update(nowHours, dtHours, level) {
      for (const st of this.stations) {
        const ss = st.session;
        if (!ss || ss.phase === Phase.Ruined) continue;
        const recipe = C.Config.recipes.find(r => r.id === ss.recipeId);

        /* 阶段推进要能**一次跨过好几段**。
           `[实测]` 原来写成 if/else-if，玩家出门一趟回来（一次 update 跨了两小时）
           只会从「烹饪中」走到「黄金窗口」，永远不会糊 —— 过火和报废形同虚设。
           用循环走到该停的地方为止。 */
        let guard = 4;
        while (guard-- > 0) {
          if (ss.phase === Phase.Cooking && nowHours >= ss.doneAt) {
            ss.phase = Phase.Golden;
            this._onDone(st, recipe, nowHours);
            continue;
          }
          // 自动断电的设备不进过火期（规格 9.2）：炖着汤出门是安全的
          if (ss.phase === Phase.Golden && nowHours >= ss.goldenEnd && !ss.autoShutoff) {
            ss.phase = Phase.Overcooked;
            continue;
          }
          if (ss.phase === Phase.Overcooked && nowHours >= ss.ruinAt) {
            ss.phase = Phase.Ruined;
            C.EventBus.publish('CookingRuinedEvent', { stationId: st.id, recipeId: ss.recipeId });
            continue;
          }
          break;
        }
      }
      // 气味到期：声图那边和这边各清各的（那边是权威，这边只是给界面看的镜像）
      if (C.SoundSystem.graph) C.SoundSystem.graph.expireOdors(nowHours);
      for (let i = this.odors.length - 1; i >= 0; i--) {
        if (this.odors[i].until <= nowHours) this.odors.splice(i, 1);
      }
    },

    _onDone(st, recipe, nowHours) {
      const K = C.Config.cooking;
      const H = st.heater ? K.heaters[st.heater] : null;
      // 结束提示音：**微波炉那声「叮」是全游戏最尴尬的死法之一。这是有意的。**
      if (H && H.done > 0 && !st.debuzzed) {
        C.SoundSystem.emit({
          worldPosition: st.pos, loudness: H.done, category: C.SoundCategory.Impact,
          emitterId: -1, label: H.name + '提示音'
        });
      }
      if (H && H.autoShutoff && H.watt > 0 && st.link) {
        C.Power.setDevice(st.link, st.deviceId, false);
      }
      // 高压锅：完成后必须泄压
      if (st.cookware === 'pressure') st.session.venting = K.cookware.pressure.ventQuietMinutes;
      this._applyOdor(st, recipe, nowHours);
      C.EventBus.publish('CookingCompletedEvent', { stationId: st.id, recipeId: recipe.id });
    },

    /* ── 高压锅泄压（规格 9.3）────────────────────────
       被追击时那 15 分钟的等待会变得非常煎熬。 */
    vent(st, force) {
      const ss = st.session;
      if (!ss || ss.venting <= 0) return { ok: false, msg: '不需要泄压' };
      const cw = C.Config.cooking.cookware.pressure;
      ss.venting = 0;
      C.SoundSystem.emit({
        worldPosition: st.pos, loudness: force ? cw.ventLoud : cw.ventQuietLoud,
        category: C.SoundCategory.Impact, emitterId: -1,
        label: force ? '高压锅强制泄压' : '高压锅泄压'
      });
      return { ok: true, msg: force ? '嗤——（全楼都听见了）' : '泄压完毕' };
    },

    /* ── 取出成品 ─────────────────────────────────────
       返回一份「食物」：饱食/解渴按阶段、调味、熟练度、锅具加成一起算出来。 */
    take(st, nowHours) {
      const ss = st.session;
      if (!ss) return { ok: false, msg: '锅里没东西' };
      const recipe = C.Config.recipes.find(r => r.id === ss.recipeId);
      const K = C.Config.cooking;
      if (nowHours < ss.doneAt) return { ok: false, msg: '还没好' };

      let mul = 1;
      if (ss.phase === Phase.Ruined) mul = 0;
      else if (ss.phase === Phase.Overcooked) {
        // 过火期线性衰减到 40%
        const t = M.clamp((nowHours - ss.goldenEnd) / (ss.ruinAt - ss.goldenEnd), 0, 1);
        mul = M.lerp(1, K.overcookFloor, t);
      }

      // 调味料是**乘数不是加数**
      let satiety = recipe.satiety * (1 + ss.seasonings * K.seasoningBonus);
      let thirst = recipe.thirst;
      if (st.cookware) {
        const cw = K.cookware[st.cookware];
        satiety *= 1 + (cw.satiety || 0);
        if (thirst < 0) thirst *= 1 + (cw.thirst || 0);     // 解渴的才吃锅具加成
        if (cw.halfBatch) satiety *= 0.5;
      }
      satiety *= 1 + this.levelDef().satiety;
      satiety = C.ModifierPipeline.query('cooking.satiety', satiety, 0);             // 老饕

      let name = recipe.name, odor = recipe.odor;
      if (ss.phase === Phase.Ruined) {
        name = '糊掉的' + recipe.name;
        satiety = K.ruinedSatiety; thirst = 0; odor = K.ruinedOdor;
      } else {
        satiety *= mul;
        if (thirst < 0) thirst *= mul;
      }

      // 黄金窗口内取出（需要看火的设备）额外给经验
      let xp = this._gainMakeXp(recipe.id);
      if (ss.phase === Phase.Golden && !ss.autoShutoff) {
        this.xp += C.Config.cookingSkill.xpGoldenWindow;
        xp += C.Config.cookingSkill.xpGoldenWindow;
      }
      if (st.cookware && !this.usedCookware[st.cookware]) {
        this.usedCookware[st.cookware] = 1; this.xp += C.Config.cookingSkill.xpNewCookware;
      }
      if (st.heater && !this.usedHeaters[st.heater]) {
        this.usedHeaters[st.heater] = 1; this.xp += C.Config.cookingSkill.xpNewHeater;
      }

      // 取走成品 = 端锅下灶：把设备关掉，免得白烧电（要看火的设备尤其）
      const H2 = st.heater ? K.heaters[st.heater] : null;
      if (H2 && H2.watt > 0 && st.link) C.Power.setDevice(st.link, st.deviceId, false);
      st.session = null;
      return {
        ok: true,
        food: {
          recipeId: recipe.id, name,
          satiety: Math.round(satiety * 10) / 10,
          thirst: Math.round(thirst * 10) / 10,
          odor,
          buff: ss.phase === Phase.Ruined ? null : (recipe.buff || null),
          gives: recipe.gives || null,
          count: recipe.outputCount || 1,
          madeAt: nowHours,
          freshHours: K.cookedFreshHours
        },
        xp, phase: ss.phase,
        msg: (ss.phase === Phase.Ruined ? '糊了：' : '做好了：') + name
      };
    },

    /* ── 中断（规格 9.4）────────────────────────────── */
    ruinAllOn(link, why) {
      let n = 0;
      for (const st of this.stations) {
        if (st.link !== link || !st.session) continue;
        if (st.session.phase === Phase.Cooking) { st.session.phase = Phase.Ruined; n++; }
      }
      if (n) C.EventBus.publish('CookingRuinedEvent', { count: n, why });
      return n;
    },
    /** 玩家手动关火：**保留进度，可重新开始** */
    stop(st) {
      if (!st.session) return { ok: false, msg: '没在做饭' };
      const H = st.heater ? C.Config.cooking.heaters[st.heater] : null;
      if (H && H.watt > 0 && st.link) C.Power.setDevice(st.link, st.deviceId, false);
      st.session = null;
      return { ok: true, msg: '关火了' };
    },

    /* ── 气味（规格 10.2）─────────────────────────────
       不做传播模拟，简化为区域性的临时修正：所在节点 + 所有直接相邻节点，
       丧尸听觉阈值 −(等级 × 2)，持续 等级 × 45 游戏分钟。
       **关门可以阻断气味** —— 再次强化「关门」这个核心动词。 */
    _applyOdor(st, recipe, nowHours) {
      if (!recipe.odor || !C.SoundSystem.graph || !st.pos) return;
      const g = C.SoundSystem.graph;
      const node = g.getNodeAt(st.pos);
      if (!node) return;
      const K = C.Config.cooking;
      const drop = recipe.odor * K.odorThresholdPerLevel;
      const until = nowHours + (recipe.odor * K.odorMinutesPerLevel) / 60;
      const nodes = [node.id];
      for (const pid of node.portals) {
        const p = g.getPortal(pid);
        if (!g.isPassable(p)) continue;               // 关着的门挡住气味
        nodes.push(g.other(p, node.id));
      }
      g.addOdor(nodes, drop, until);
      for (const nid of nodes) this.odors.push({ nodeId: nid, level: recipe.odor, until });
      C.EventBus.publish('OdorEvent', { nodeIds: nodes, level: recipe.odor, until });
    },
    clearOdors() { if (C.SoundSystem.graph) C.SoundSystem.graph.clearOdors(); this.odors = []; },

    /** 某个节点当前的气味等级（界面/丧尸阈值查询用） */
    odorAt(nodeId) {
      let lv = 0;
      for (const o of this.odors) if (o.nodeId === nodeId) lv = Math.max(lv, o.level);
      return lv;
    },

    /* ── 持续噪音（规格 10.1）：由装配层按真实秒驱动 ── */
    emitProcessNoise(dtSeconds) {
      this._acc = (this._acc || 0) + dtSeconds;
      if (this._acc < 2) return;
      this._acc = 0;
      for (const st of this.stations) {
        const ss = st.session;
        if (!ss || ss.phase === Phase.Ruined || !st.pos) continue;
        const recipe = C.Config.recipes.find(r => r.id === ss.recipeId);
        if (!recipe) continue;
        let loud = recipe.loud;
        if (ss.phase === Phase.Cooking || ss.phase === Phase.Golden) {
          const H = st.heater ? C.Config.cooking.heaters[st.heater] : null;
          if (H) loud = Math.max(loud, H.idle);
        }
        if (ss.phase === Phase.Overcooked) loud += C.Config.cooking.overcookLoudAdd;
        if (loud <= 0) continue;
        C.SoundSystem.emit({
          worldPosition: st.pos, loudness: loud, category: C.SoundCategory.Ambient,
          emitterId: -1, label: recipe.name + '（' + ss.phase + '）'
        });
      }
    },

    addStation(opts) {
      const st = new Station(this._nextStation++, opts);
      this.stations.push(st);
      return st;
    },

    serialize() {
      return {
        xp: this.xp, made: this.made,
        usedCookware: this.usedCookware, usedHeaters: this.usedHeaters,
        stations: this.stations.map(st => ({
          id: st.id, pos: st.pos ? C.V.copy(st.pos) : null, surface: st.surface, slots: st.slots,
          heater: st.heater, cookware: st.cookware, deviceId: st.deviceId, debuzzed: !!st.debuzzed,
          linkId: st.link ? st.link.id : null,
          session: st.session ? {
            recipeId: st.session.recipeId, startAt: st.session.startAt,
            totalMinutes: st.session.totalMinutes, doneAt: st.session.doneAt,
            goldenEnd: st.session.goldenEnd, ruinAt: st.session.ruinAt,
            phase: st.session.phase, seasonings: st.session.seasonings,
            autoShutoff: st.session.autoShutoff, venting: st.session.venting
          } : null
        }))
      };
    },
    deserialize(d) {
      this.reset();
      if (!d) return this;
      this.xp = d.xp || 0;
      this.made = d.made || {};
      this.usedCookware = d.usedCookware || {};
      this.usedHeaters = d.usedHeaters || {};
      for (const r of d.stations || []) {
        const st = this.addStation({ pos: r.pos, surface: r.surface, slots: r.slots,
                                     heater: r.heater, cookware: r.cookware, deviceId: r.deviceId });
        st.id = r.id; st.debuzzed = r.debuzzed;
        st.link = C.Power.links.find(l => l.id === r.linkId) || null;
        if (r.session) st.session = Object.assign(Object.create(Session.prototype), r.session);
      }
      this._nextStation = this.stations.reduce((n, s) => Math.max(n, s.id + 1), 1);
      return this;
    }
  };

  C.CookPhase = Phase;
  C.KitchenStation = Station;
  C.Cooking = Cooking;
})(typeof globalThis !== 'undefined' ? globalThis : this);
