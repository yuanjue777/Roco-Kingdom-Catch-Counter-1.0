/*
 * 11-zombie.js —— 丧尸（主文档 5.2–5.5，声音规格 5.2 / 5.3）
 *
 * 状态机：
 *   游荡 ──听到声音──> 警觉(转向,延迟) ──延迟结束──> 调查(走向目标点)
 *   调查 ──到达目标点──> 搜索(原地徘徊 8~15s) ──超时──> 返回游荡
 *   任意状态 ──看见玩家(识别条满)──> 追击 ──失去目标 6s──> 搜索
 */
(function (root) {
  /* 简化模拟允许的最大单步位移。必须小于最薄的墙（0.2m），否则会穿过去。 */
  const SIM_STEP = 0.15;

  const C = (root.Campus = root.Campus || {});
  const { V, M, AABB } = C;

  const State = { Wander: '游荡', Alert: '警觉', Investigate: '调查', Search: '搜索', Chase: '追击', Prone: '趴伏' };
  let nextId = 100;

  function Zombie(def, world) {
    const T = C.Config.zombieTypes[def.type];
    this.id = nextId++;
    this.typeName = def.type;
    this.def = T;
    this.world = world;
    this.pos = V.copy(def.pos);
    this.yaw = 0;
    this.hp = T.hp;
    this.alive = true;
    this.state = def.type === 'Crawler' ? State.Prone : State.Wander;
    this.nodeId = -1;
    this.homeNodeId = -1;
    this.target = null;          // 目标点（含定位误差）
    this.path = [];              // 路点队列
    this.pathIndex = 0;
    this.reactTimer = 0;
    this.searchTimer = 0;
    this.lostTimer = 0;
    this.growlTimer = 0;
    this.breathTimer = 0;
    this.shuffleTimer = Math.random() * 1.1;
    this.visionTimer = Math.random() * C.Config.zombieReaction.visionCheckInterval;
    this.recognition = 0;        // 识别条 0–0.8
    this.currentMargin = 0;
    this.chainDepth = 0;
    this.rng = new C.Rng(this.id * 7919 + 13);
    this.stuckTimer = 0;
    this.lastPos = V.copy(def.pos);
    // 布置时标了「第 12 天变成奔行者」的那 5%（7.2）。在那之前它就是一只普通游荡者。
    this.becomesRunner = !!def.becomesRunner;
    /* 教学关卡 205 里那只：**永远出不来，不受任何事件影响**（教学设计 3.3）。
       它是整个教学最重要的设计 —— 玩家可以在它门口把每一条声音规则亲手验证一遍，
       而且不会死。这比任何文字提示都有效。 */
    this.lockedIn = !!def.lockedIn;
    this.simplified = false;      // 分区加载：不在加载范围内时走简化模拟
    this._simAcc = 0;

    this.hearing = new C.HearingComponent({
      ownerId: this.id, baseThreshold: T.threshold,
      smells: true,                 // 丧尸闻得到饭味（烹饪规格 10.2）
      onHeard: (info) => this._onHeard(info)
    });
    C.SoundSystem.registerListener(this.hearing);
  }

  Zombie.prototype.eyePos = function () { return { x: this.pos.x, y: this.pos.y + this.def.eyeHeight, z: this.pos.z }; };
  Zombie.prototype.isAlerted = function () {
    return this.state === State.Alert || this.state === State.Investigate ||
           this.state === State.Search || this.state === State.Chase;
  };

  Zombie.prototype._setState = function (s) {
    if (this.state === s) return;
    const prev = this.state;
    this.state = s;
    // 警觉中的丧尸阈值降到 6（声音规格 6.3）——通过管线，不写死
    const key = 'hearing.threshold', id = 'alert.' + this.id;
    if (this.isAlerted() && !C.ModifierPipeline.has(key, id)) {
      C.Mod.override(key, id, () => C.Config.hearing.zombieAlert, this.id, 50);
    } else if (!this.isAlerted()) {
      C.Mod.remove(key, id);
    }
    C.EventBus.publish(C.Events.ZombieStateChanged, { id: this.id, prev, state: s });
  };

  Zombie.prototype._onHeard = function (info) {
    if (!this.alive) return;
    const R = C.Config.zombieReaction;
    const evt = info.evt;

    if (evt.emitterId >= 100) {
      /* 同类发出的声音：只有低吼会引人，且受连锁层数上限约束（主文档 5.5）。
         脚步与呼吸一概忽略 —— 否则 A 的脚步引来 B，B 一走又发出脚步再引来 C，
         整层楼会自激成一锅粥。这些声音的存在意义是让玩家听见，不是让丧尸互相听见。 */
      if (evt.category !== C.SoundCategory.Voice) return;
      if (evt.chainDepth >= R.chainMaxDepth) return;
    }
    if (this.state === State.Chase) return;                       // 已经看见玩家，不被声音打断
    // 蜷伏者：只有声源在 riseDistance 内才起身（主文档 5.2）
    if (this.state === State.Prone) {
      if (V.dist(evt.worldPosition, this.pos) > this.def.riseDistance) return;
    }
    // 优先级覆盖：已在调查时，新声音必须显著更响才切目标（声音规格 5.3）
    if (this.state === State.Alert || this.state === State.Investigate) {
      if (info.margin < this.currentMargin + R.switchTargetMarginBonus) return;
    }

    this.currentMargin = info.margin;
    // 目标点偏移在接收事件时确定一次并固定，不每帧重算（否则丧尸会抖）
    const err = C.Reaction.localizationError(info.margin);
    const ang = this.rng.next() * Math.PI * 2;
    const rad = Math.sqrt(this.rng.next()) * err;
    this.target = V.make(evt.worldPosition.x + Math.cos(ang) * rad, evt.worldPosition.y, evt.worldPosition.z + Math.sin(ang) * rad);
    this.targetTrue = V.copy(evt.worldPosition);
    this.targetError = err;
    this.reactTimer = C.Reaction.delay(info.margin);
    // 先停下、转头朝向声音传来的路径入口方向
    this.faceDir = info.dir;
    this.chainCause = (evt.category === C.SoundCategory.Voice && evt.emitterId >= 100) ? evt.chainDepth + 1 : 0;
    this.path = []; this.pathIndex = 0;
    this._setState(State.Alert);
  };

  /**
   * @param simplified 简化模拟（主文档 13.4）：跳过视觉检测，其余照跑。
   *   它仍然听得见声音、仍然会更新目标并走过去 —— 文档要求的就是这个。
   *   省掉的是视线射线检测，以及每帧一次的调用频率（管理器攒到 0.25s 再调一次）。
   */
  Zombie.prototype.update = function (dt, player, time, simplified) {
    if (!this.alive) return;
    this.simplified = !!simplified;
    const R = C.Config.zombieReaction;
    const g = C.SoundSystem.graph;

    const node = g.getNodeAt(this.eyePos(), this.nodeId);
    this.nodeId = node ? node.id : -1;
    if (this.homeNodeId < 0) this.homeNodeId = this.nodeId;
    this.hearing.position = this.eyePos();
    this.hearing.nodeId = this.nodeId;

    /* 常态声：**站着不动的丧尸也会出声**，否则它在声音系统里等于不存在，
       屏息侦查也就只能发现正在走动的那些。
         趴着的蜷伏者 —— 呼吸 12，几乎贴脸才听得见，这是屏息作为侦查工具的核心价值
         站着的其余丧尸 —— 低哑嘶吼 28，比脚步(48) 近一截但足够看见声纹
       两者都走 Ambient：**不参与连锁警戒**（只有 Voice 会），
       否则一屋子丧尸会被彼此的呼吸声互相点着。 */
    if (this.def.breathInterval) {
      const prone = this.state === State.Prone;
      const loud = prone ? C.Config.loudness.crawlerBreath : this.def.breathLoudness;
      if (loud > 0) {
        this.breathTimer -= dt;
        if (this.breathTimer <= 0) {
          // 随机相位：不加的话同一时刻生成的几百只会整齐划一地一起喘
          this.breathTimer = this.def.breathInterval * this.rng.range(0.8, 1.2);
          C.SoundSystem.emit({
            worldPosition: this.pos,
            loudness: C.ModifierPipeline.query('sound.zombieAmbient', loud, this.id),
            category: C.SoundCategory.Ambient, emitterId: this.id, nodeIdHint: this.nodeId,
            label: prone ? '蜷伏者呼吸' : '低哑嘶吼'
          });
        }
      }
    }

    // 简化模拟里不做视觉：看不见玩家的丧尸不会进入追击，而玩家不在附近时它本来也看不见
    if (this.state !== State.Prone && !simplified) this._updateVision(dt, player, time);

    /* 被锁住的：状态照常变（听得见、会警觉），但**永远不寻路、不离开本节点**。
       警觉/追击时改成扑门 —— 撞得很响，正是玩家要观察的现象。 */
    if (this.lockedIn) {
      this._bangCooldown = Math.max(0, (this._bangCooldown || 0) - dt);
      if (this.state === State.Alert || this.state === State.Investigate ||
          this.state === State.Chase || this.state === State.Search) {
        if (this.faceDir) this._turnTo(Math.atan2(this.faceDir.x, this.faceDir.z), dt, 3.0);
        this._bangDoor();
      } else {
        this._wander(dt, 0.5);              // 在屋里来回走
      }
      this.lastPos = V.copy(this.pos);
      return;
    }

    switch (this.state) {
      case State.Prone: break;
      case State.Wander: this._wander(dt); break;
      case State.Alert:
        if (this.faceDir) this._turnTo(Math.atan2(this.faceDir.x, this.faceDir.z), dt, 3.0);
        this.reactTimer -= dt;
        if (this.reactTimer <= 0) { this._pathTo(this.target); this._setState(State.Investigate); }
        break;
      case State.Investigate:
        if (this._follow(dt, this._investigateSpeed())) {
          this.searchTimer = this.rng.range(R.searchDurationMin, R.searchDurationMax);
          this._setState(State.Search);
        }
        break;
      case State.Search:
        this.searchTimer -= dt;
        this._wander(dt, 0.6);
        if (this.searchTimer <= 0) { this.currentMargin = 0; this.target = null; this._setState(State.Wander); }
        break;
      case State.Chase: this._chase(dt, player); break;
    }

    // 卡住检测：位置几乎没变但应该在移动 → 放弃当前路径
    if (this.state === State.Investigate || this.state === State.Chase) {
      if (V.distXZ(this.pos, this.lastPos) < 0.02) {
        this.stuckTimer += dt;
        if (this.stuckTimer > 1.5) {
          this.stuckTimer = 0;
          this.searchTimer = 6;
          this._setState(State.Search);
        }
      } else this.stuckTimer = 0;
    }
    /* 未趴伏的丧尸只要在动就会拖出脚步声 —— 玩家屏息时靠这个提前发现它们。
       必须放在帧末：lastPos 是上一帧末尾的快照，在帧首比较的话两者永远相等。 */
    if (this.state !== State.Prone && V.distXZ(this.pos, this.lastPos) > 0.004) {
      this.shuffleTimer -= dt;
      if (this.shuffleTimer <= 0) {
        this.shuffleTimer = this.def.shuffleInterval || 1.1;
        C.SoundSystem.emit({
          worldPosition: this.pos, loudness: C.Config.loudness.zombieShuffle,
          category: C.SoundCategory.Footstep, emitterId: this.id,
          nodeIdHint: this.nodeId, label: '丧尸脚步'
        });
      }
    }

    this.lastPos = V.copy(this.pos);
  };

  /** 当前状态下的移动速度上限。简化模拟拿它算该拆成几小步。 */
  Zombie.prototype.speed = function () {
    return this.state === State.Chase ? this.def.speedChase
         : this.state === State.Investigate || this.state === State.Search ? this._investigateSpeed()
         : this.def.speedWander;
  };

  Zombie.prototype._investigateSpeed = function () {
    // TODO 文档只给了「游荡 1.0 / 追击 3.2」，调查速度未定义。此处为占位值，需实测。
    return this.def.speedWander * (C.Config.zombieReaction.investigateSpeedMul || 1.6);
  };

  Zombie.prototype._updateVision = function (dt, player, time) {
    const R = C.Config.zombieReaction, VZ = C.Config.vision;
    this.visionTimer -= dt;
    if (this.visionTimer > 0) return;
    this.visionTimer = R.visionCheckInterval;
    if (!player.alive) return;

    let radius = this.def.visionRadius;
    if (time.isNight()) {
      radius *= VZ.nightRadiusMul;
      if (player.flashlight) radius *= VZ.flashlightRadiusMul;   // 手电让你在夜里更显眼
    }
    radius *= player.detectMultiplier();                          // 蹲下 ×0.6，探头 ×0.35

    const eye = this.eyePos(), pEye = player.eyePos();
    const to = V.sub(pEye, eye);
    const dist = V.len(to);
    let visible = false;
    if (dist <= radius) {
      const fwd = { x: Math.sin(this.yaw), y: 0, z: Math.cos(this.yaw) };
      const flat = V.norm({ x: to.x, y: 0, z: to.z });
      const cosA = V.dot(fwd, flat);
      const half = Math.cos((this.def.visionAngle / 2) * M.deg2rad);
      if (cosA >= half || dist < 1.5) {
        if (this.world.lineOfSight(eye, pEye)) visible = true;
      }
    }

    if (visible) {
      this.recognition += R.visionCheckInterval;                  // 0.8 秒的识别条
      if (this.recognition >= R.recognitionTime && this.state !== State.Chase) {
        this.chainDepth = 0;                                      // 亲眼看见玩家，是连锁的源头
        this._setState(State.Chase);
      }
      this.lastSeen = V.copy(pEye);
      this.lostTimer = 0;
    } else {
      this.recognition = Math.max(0, this.recognition - R.visionCheckInterval * 0.7);
    }
    this.visible = visible;
  };

  Zombie.prototype._chase = function (dt, player) {
    const R = C.Config.zombieReaction;
    if (this.visible) { this.lostTimer = 0; this.target = V.copy(player.pos); this.path = []; }
    else {
      this.lostTimer += dt;
      if (this.lostTimer >= R.loseTargetSeconds) {
        this.searchTimer = this.rng.range(R.searchDurationMin, R.searchDurationMax);
        this._setState(State.Search);
        return;
      }
    }
    // 追击时持续发出低吼——这会引来更多丧尸
    this.growlTimer -= dt;
    if (this.growlTimer <= 0) {
      this.growlTimer = R.growlInterval;
      C.SoundSystem.emit({
        worldPosition: this.pos, loudness: C.Config.loudness.zombieGrowl,
        category: C.SoundCategory.Voice, emitterId: this.id,
        nodeIdHint: this.nodeId, chainDepth: this.chainDepth, label: '低吼'
      });
    }
    const goal = this.visible ? player.pos : (this.lastSeen || this.pos);
    if (this.visible && Math.abs(goal.y - this.pos.y) < 1.0) this._steer(goal, this.def.speedChase, dt);
    else { if (!this.path.length) this._pathTo(goal); this._follow(dt, this.def.speedChase); }

    if (V.distXZ(this.pos, player.pos) < R.catchDistance && Math.abs(this.pos.y - player.pos.y) < 1.6) {
      player.die('被' + this.def.name + '抓住');
    }
  };

  /** 撞门：被锁住的那只听见动静时会扑向门 —— 玩家听得见，这就是它的教学价值 */
  Zombie.prototype._bangDoor = function () {
    if (this._bangCooldown > 0) return;
    this._bangCooldown = 2.5;
    C.SoundSystem.emit({
      worldPosition: this.pos, loudness: C.Config.loudness.doorBang || 70,
      category: C.SoundCategory.Impact, emitterId: this.id,
      nodeIdHint: this.nodeId, label: '撞门'
    });
  };

  Zombie.prototype._wander = function (dt, speedMul) {
    if (!this.wanderTarget || V.distXZ(this.pos, this.wanderTarget) < 0.5) {
      this.wanderPause = this.rng.range(1.5, 4.0);
      const node = C.SoundSystem.graph.getNode(this.state === State.Search ? this.nodeId : this.homeNodeId);
      if (node) {
        const b = node.bounds;
        this.wanderTarget = V.make(
          this.rng.range(b.min.x + 0.6, b.max.x - 0.6),
          this.pos.y,
          this.rng.range(b.min.z + 0.6, b.max.z - 0.6));
      }
    }
    if (this.wanderPause > 0) { this.wanderPause -= dt; return; }
    if (this.wanderTarget) this._steer(this.wanderTarget, this.def.speedWander * (speedMul || 1), dt);
  };

  /** 沿路点前进。返回 true 表示已到达终点。 */
  Zombie.prototype._follow = function (dt, speed) {
    if (this.pathIndex >= this.path.length) return true;
    const wp = this.path[this.pathIndex];
    if (V.distXZ(this.pos, wp) < 0.7 && Math.abs(this.pos.y - wp.y) < 2.6) {
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) return true;
    }
    this._steer(this.path[this.pathIndex], speed, dt);
    return false;
  };

  Zombie.prototype._steer = function (goal, speed, dt) {
    const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return;
    const nx = dx / len, nz = dz / len;
    this._turnTo(Math.atan2(nx, nz), dt, 6.0);
    /* 碰撞体只把高度从 1.7 降到 1.6（跟着模型变矮），**半径仍然是 0.38**。
       `[实测]` 半径低于 0.36 时丧尸会卡在楼梯上爬不上去 —— 楼梯踏板只有 0.3m 深，
       半径一小，它就能挤进踏板的立面里，然后被「推到最近的面」推回来，来回震荡。
       模型宽 0.42 而碰撞直径 0.76，是有出入，但宁可撞得早一点，不要卡楼梯。
       根因在碰撞层（见待决策 #17），这里先按住不动。 */
    this.world.moveCharacter(this.pos, nx * speed * dt, nz * speed * dt, 0.38, 1.6, C.Config.player.stepHeight);
  };

  Zombie.prototype._turnTo = function (targetYaw, dt, rate) {
    this.yaw += M.clamp(M.wrapAngle(targetYaw - this.yaw), -rate * dt, rate * dt);
  };

  /** 在 Portal 图上找路。只走 passable 的连接（Closed / Blocked 挡人） */
  Zombie.prototype._pathTo = function (goal) {
    this.path = []; this.pathIndex = 0;
    if (!goal) return;
    const g = C.SoundSystem.graph;
    const goalNode = g.getNodeAt(goal);
    if (!goalNode) return;
    if (goalNode.id === this.nodeId) { this.path = [V.copy(goal)]; return; }

    const prev = new Map();          // nodeId -> {portal, from}
    const queue = [this.nodeId];
    const seen = new Set([this.nodeId]);
    let found = false;
    while (queue.length) {
      const cur = queue.shift();
      if (cur === goalNode.id) { found = true; break; }
      const node = g.getNode(cur);
      if (!node) continue;
      for (const pid of node.portals) {
        const p = g.getPortal(pid);
        if (!g.isPassable(p)) continue;
        const other = g.other(p, cur);
        if (seen.has(other)) continue;
        seen.add(other);
        prev.set(other, { portal: p, from: cur });
        queue.push(other);
      }
    }
    if (!found) return;

    const chain = [];
    let cur = goalNode.id;
    while (cur !== this.nodeId) {
      const step = prev.get(cur);
      if (!step) return;
      chain.unshift(step);
      cur = step.from;
    }
    for (const step of chain) {
      const p = step.portal;
      if (p.waypoints) {
        const fwd = (p.nodeA === step.from);
        const wps = fwd ? p.waypoints : p.waypoints.slice().reverse();
        for (const w of wps) this.path.push(V.copy(w));
      } else {
        this.path.push(V.copy(p.position));
      }
    }
    this.path.push(V.copy(goal));
  };

  /** 换一个类型（第 12 天游荡者变奔行者）。阈值走管线，不写死。 */
  Zombie.prototype.setType = function (name) {
    const T = C.Config.zombieTypes[name];
    if (!T || this.typeName === name) return false;
    this.typeName = name;
    this.def = T;
    this.hearing.baseThreshold = T.threshold;
    return true;
  };

  Zombie.prototype.destroy = function () {
    this.alive = false;
    C.SoundSystem.unregisterListener(this.hearing);
    C.ModifierPipeline.unregister('hearing.threshold', 'alert.' + this.id);
  };

  // ── 管理器：负责同时追击上限 ────────────────────────
  const ZombieManager = {
    list: [],
    spawnAll(level, world) {
      this.list.length = 0;
      for (const s of level.zombieSpawns) this.list.push(new Zombie(s, world));
      return this.list;
    },
    spawn(def, world) { const z = new Zombie(def, world); this.list.push(z); return z; },
    update(dt, player, time) {
      this._promoteRunners(time);
      const far = C.Streaming ? C.Streaming.simplifyDistance() : Infinity;
      const tick = C.Config.campus.simplifiedTick;
      for (const z of this.list) {
        if (!z.alive) continue;
        if (V.distXZ(z.pos, player.pos) <= far) { z._simAcc = 0; z.update(dt, player, time, false); continue; }
        /* 远处的丧尸攒够一个 tick 再动一次。步长必须留在 0.5m 以内，
           否则一步跨过 0.2m 厚的隔墙，等玩家走近时会发现它站在墙里。 */
        z._simAcc += dt;
        if (z._simAcc < tick) continue;
        const acc = Math.min(z._simAcc, tick * 2);
        z._simAcc = 0;
        /* 攒下来的时间不能一步走完：奔行者 5.4m/s × 0.5s = 2.7m，
           一步就跨过 0.2m 厚的隔墙，等玩家走近会发现它站在墙里。
           拆成每步不超过 SIM_STEP 的若干小步 —— 省下的是视线检测和调用次数，
           不是碰撞的正确性。 */
        const n = Math.max(1, Math.ceil(z.speed() * acc / SIM_STEP));
        for (let i = 0; i < n; i++) z.update(acc / n, player, time, true);
      }
      this._enforceChaseCap(player);
    },

    /** 第 12 天：布置时标记过的那 5% 换成奔行者（7.2）。只发生一次。 */
    _promoteRunners(time) {
      const day = C.Config.campus.runnerFromDay;
      if (!time || time.day < day || this._runnersOut) return;
      this._runnersOut = true;
      let n = 0;
      for (const z of this.list) if (z.alive && z.becomesRunner && z.setType('Runner')) n++;
      if (n) C.EventBus.publish('RunnersAppearedEvent', { count: n, day: time.day });
    },
    /** 同时处于追击状态的丧尸全场上限；超过时最远的转为搜索（主文档 5.5） */
    _enforceChaseCap(player) {
      const cap = C.Config.zombieReaction.maxChasers;
      const chasers = this.list.filter(z => z.alive && z.state === State.Chase);
      if (chasers.length <= cap) return;
      chasers.sort((a, b) => V.dist(b.pos, player.pos) - V.dist(a.pos, player.pos));
      for (let i = 0; i < chasers.length - cap; i++) {
        const z = chasers[i];
        z.searchTimer = 8;
        z._setState(State.Search);
      }
    },
    countByState() {
      const m = {};
      for (const z of this.list) m[z.state] = (m[z.state] || 0) + 1;
      return m;
    },
    reset() { for (const z of this.list) z.destroy(); this.list.length = 0; nextId = 100; this._runnersOut = false; }
  };

  C.ZombieState = State;
  C.Zombie = Zombie;
  C.ZombieManager = ZombieManager;
})(typeof globalThis !== 'undefined' ? globalThis : this);
