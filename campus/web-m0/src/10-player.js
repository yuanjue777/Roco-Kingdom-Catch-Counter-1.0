/*
 * 10-player.js —— 玩家控制器（主文档 4.1–4.4，3.3）
 * 只依赖：World（碰撞）、SoundSystem（发声/听声）、ModifierPipeline（取最终值）。
 * 不知道渲染与 UI 的存在，渲染层反过来读它的状态。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const { V, M } = C;
  const PLAYER_ID = 1;

  function Player(level, world) {
    const P = C.Config.player;
    this.id = PLAYER_ID;
    this.world = world;
    this.pos = V.make(level.spawn.x, level.spawn.y, level.spawn.z);
    this.yaw = level.spawn.yaw; this.pitch = 0;
    this.posture = 'stand';           // stand / crouch
    this.wallHug = false; this.wallNormal = null;
    this.lean = 0;                    // -1 左 / 0 / +1 右
    this.holdBreath = false;
    this.stamina = P.stamina.max;
    this.exhausted = false;
    this.flashlight = false;
    this.alive = true;
    this.nodeId = -1;
    this.speedNow = 0;
    this.moving = false;
    this._stepTimer = 0;
    this._breathTimer = 0;
    this._interactHeld = 0;
    this._interactTarget = null;
    this._interactDone = false;
    this.charge = 0;                  // 投掷蓄力 0–1
    this.stones = 12;
    this.soundprints = [];            // 声纹（HUD 用）
    this.lastAction = '';

    // 听觉组件：与丧尸共用同一个类
    this.hearing = new C.HearingComponent({
      ownerId: PLAYER_ID, baseThreshold: C.Config.hearing.player, baseLocalization: 0,
      onHeard: (info) => this._onHeard(info)
    });
    C.SoundSystem.registerListener(this.hearing);

    this._registerModifiers();
  }

  /* 所有加成一律注册进管线，业务代码只向管线要最终值（主文档 11.3） */
  Player.prototype._registerModifiers = function () {
    const P = () => C.Config.player;
    const wr = () => M.clamp(P().weightRatio, 0, 2);
    // 负重（主文档 7.1）
    C.Mod.mul('sound.footstep', 'weight', () => 1 + P().weightLoudnessCoef * wr(), PLAYER_ID, 10);
    C.Mod.mul('stamina.run_cost', 'weight', () => 1 + P().weightStaminaCoef * wr(), PLAYER_ID, 10);
    C.Mod.mul('move.run_speed', 'weight', () => 1 - P().weightSpeedCoef * wr(), PLAYER_ID, 10);
    // 静步熟练度（主文档 8.5）
    C.Mod.mul('sound.footstep', 'skill.quietStep', () => {
      const s = C.Config.skills.quietStep;
      return 1 - (s.loudnessReduction[M.clamp(s.level, 0, 5)] || 0);
    }, PLAYER_ID, 0);
    // 听觉熟练度：方向误差
    C.Mod.add('hearing.localization', 'skill.hearing', () => {
      const s = C.Config.skills.hearing;
      return s.errorReduction[M.clamp(s.level, 0, 5)] || 0;
    }, PLAYER_ID, 0);
  };

  Player.prototype._onHeard = function (info) {
    // 方向角误差 =(1 − 听觉熟练度系数) × 基准角误差（声音规格 5.4）
    const err = (1 - info.localization) * C.Config.hearing.baseAngleError * M.deg2rad;
    // 误差用事件 id 做种子，同一个事件的指示方向不会每帧抖动
    const rng = new C.Rng(info.evt.id * 2654435761 + 17);
    const offset = (rng.next() * 2 - 1) * err;
    const trueAngle = Math.atan2(info.dir.x, info.dir.z);
    this.soundprints.push({
      angle: trueAngle + offset,
      category: info.evt.category,
      band: C.Reaction.distanceBand(info.margin),
      margin: info.margin,
      born: performance.now() / 1000,
      evtId: info.evt.id
    });
    if (this.soundprints.length > 24) this.soundprints.shift();
  };

  Player.prototype.eyeHeight = function () {
    const P = C.Config.player;
    return this.posture === 'crouch' ? P.eyeHeightCrouch : P.eyeHeightStand;
  };
  Player.prototype.eyePos = function () {
    return { x: this.pos.x, y: this.pos.y + this.eyeHeight(), z: this.pos.z };
  };
  /** 丧尸看见玩家的半径乘数（主文档 4.5） */
  Player.prototype.detectMultiplier = function () {
    const v = C.Config.vision;
    if (this.lean !== 0) return v.peekDetectMul;
    if (this.posture === 'crouch') return v.crouchDetectMul;
    return 1.0;
  };

  Player.prototype.baseLoudnessKey = function () {
    if (this.holdBreath) return null;
    if (this.wallHug) return 'wallHug';
    if (this.posture === 'crouch') return 'crouch';
    return this.running ? 'run' : 'walk';
  };

  Player.prototype.update = function (dt, input, time) {
    if (!this.alive) return;
    const P = C.Config.player, S = P.stamina;

    // ── 姿态 ──────────────────────────────────────────
    this.posture = input.crouch ? 'crouch' : 'stand';
    this.lean = input.lean;
    this.holdBreath = input.holdBreath && this.stamina > 0;
    const wall = input.wallHug ? this.world.probeWall(this.pos, 1.5, 0.95) : null;
    this.wallHug = !!wall;
    this.wallNormal = wall ? wall.normal : null;
    this.running = input.run && !input.crouch && !this.holdBreath && !this.wallHug && this.stamina > 0;

    // ── 屏息：阈值 25→8，同时提升定位精度（声音规格 5.4）──
    const hasHB = C.ModifierPipeline.has('hearing.threshold', 'holdBreath');
    if (this.holdBreath && !hasHB) {
      C.Mod.override('hearing.threshold', 'holdBreath', () => C.Config.hearing.playerHoldBreath, PLAYER_ID, 100);
      C.Mod.add('hearing.localization', 'holdBreath', 0.35, PLAYER_ID, 5);
    } else if (!this.holdBreath && hasHB) {
      C.Mod.remove('hearing.threshold', 'holdBreath');
      C.Mod.remove('hearing.localization', 'holdBreath');
    }

    // ── 速度 ──────────────────────────────────────────
    let speed;
    if (this.running) speed = C.ModifierPipeline.query('move.run_speed', P.speedRun, PLAYER_ID);
    else if (this.wallHug) speed = P.speedWallHug;
    else if (this.posture === 'crouch') speed = P.speedCrouch;
    else speed = P.speedWalk;
    if (this.holdBreath) speed = P.speedCrouch * P.holdBreathSpeedMul;   // 允许缓慢移动（主文档 4.2）
    if (this.lean !== 0) speed = 0;                                       // 侧身探头时移动速度为 0
    if (this.exhausted) speed *= S.exhaustedSpeedMul;

    // ── 移动 ──────────────────────────────────────────
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = input.right * cos - input.forward * sin;
    let mz = -input.right * sin - input.forward * cos;
    const mlen = Math.hypot(mx, mz);
    if (mlen > 1e-4) { mx /= mlen; mz /= mlen; } else { mx = mz = 0; }
    if (this.wallHug && this.wallNormal) {
      // 贴墙时把移动投影到墙面上
      const d = mx * this.wallNormal.x + mz * this.wallNormal.z;
      mx -= d * this.wallNormal.x; mz -= d * this.wallNormal.z;
    }
    this.moving = (mx !== 0 || mz !== 0) && speed > 0.01;
    this.speedNow = this.moving ? speed : 0;
    if (this.moving) this.world.moveCharacter(this.pos, mx * speed * dt, mz * speed * dt, P.radius, 1.7, P.stepHeight);
    else this.world.snapToGround(this.pos, P.radius, P.stepHeight);

    const node = C.SoundSystem.graph.getNodeAt(this.eyePos(), this.nodeId);
    this.nodeId = node ? node.id : -1;
    this.hearing.position = this.eyePos();
    this.hearing.nodeId = this.nodeId;

    // ── 体力（主文档 3.3）────────────────────────────
    let drain = 0;
    if (this.running && this.moving) drain += C.ModifierPipeline.query('stamina.run_cost', S.runCost, PLAYER_ID);
    if (this.holdBreath) drain += C.ModifierPipeline.query('hold_breath.stamina_cost', S.holdBreathCost, PLAYER_ID);
    if (drain > 0) this.stamina -= drain * dt;
    else if (!this.moving) this.stamina += (this.posture === 'crouch' ? S.regenCrouch : S.regenStand) * dt;
    this.stamina = M.clamp(this.stamina, 0, S.max);
    this.exhausted = this.stamina <= 0.01;

    // 体力耗尽的喘息：响度 25，潜行时是致命的
    if (this.exhausted) {
      this._breathTimer -= dt;
      if (this._breathTimer <= 0) {
        this._breathTimer = S.exhaustedBreathInterval;
        this.emit(C.Config.loudness.exhaustedBreath, C.SoundCategory.Voice, '喘息');
      }
    }

    // ── 脚步声（声音规格 4.4：每一步发一次离散事件）──
    if (this.moving && !this.holdBreath) {
      const interval = this.running ? P.stepIntervalRun
        : this.wallHug ? P.stepIntervalWallHug
        : this.posture === 'crouch' ? P.stepIntervalCrouch : P.stepIntervalWalk;
      this._stepTimer -= dt;
      if (this._stepTimer <= 0) {
        this._stepTimer = interval;
        const key = this.baseLoudnessKey();
        const base = C.Config.loudness[key];
        const loud = C.ModifierPipeline.query('sound.footstep', base, PLAYER_ID);
        this.emit(loud, C.SoundCategory.Footstep, key);
      }
    } else this._stepTimer = 0;

    this._updateInteract(dt, input);
    this._updateThrow(dt, input);
    this._pruneSoundprints();
  };

  Player.prototype.emit = function (loudness, category, label) {
    return C.SoundSystem.emit({
      worldPosition: this.pos, loudness, category,
      emitterId: this.id, nodeIdHint: this.nodeId, label
    });
  };

  Player.prototype._pruneSoundprints = function () {
    const now = performance.now() / 1000, life = C.Config.debug.soundprintLifetime;
    while (this.soundprints.length && now - this.soundprints[0].born > life) this.soundprints.shift();
  };

  /** 视线前方最近的可交互门/窗 */
  Player.prototype.findInteractable = function () {
    const eye = this.eyePos();
    const fwd = { x: -Math.sin(this.yaw) * Math.cos(this.pitch), y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * Math.cos(this.pitch) };
    let best = null, bestScore = -1;
    for (const d of this.world.level.doors) {
      const c = C.AABB.center(d.box);
      const to = V.sub(c, eye);
      const dist = V.len(to);
      if (dist > C.Config.interact.range) continue;
      const dot = V.dot(V.norm(to), fwd);
      if (dot < 0.5) continue;
      if (dot > bestScore) { bestScore = dot; best = d; }
    }
    return best;
  };

  Player.prototype._updateInteract = function (dt, input) {
    const I = C.Config.interact;
    const target = this.findInteractable();
    this.interactTarget = target;
    if (input.interact && target) {
      if (this._interactTarget !== target) { this._interactTarget = target; this._interactHeld = 0; this._interactDone = false; }
      this._interactHeld += dt;
      const portal = C.SoundSystem.graph.getPortal(target.portalId);
      const opening = !C.SoundSystem.graph.isPassable(portal);
      const need = opening ? I.doorSlowHoldSeconds : I.doorCloseSlowHoldSeconds;
      this.interactProgress = M.clamp(this._interactHeld / need, 0, 1);
      if (!this._interactDone && this._interactHeld >= need) {
        this._doorAction(target, true);      // 缓慢版
        this._interactDone = true;
      }
    } else {
      if (this._interactTarget && !this._interactDone && this._interactHeld > 0.02 && this._interactHeld < 0.3) {
        this._doorAction(this._interactTarget, false);   // 轻点 = 快速版
      }
      this._interactTarget = null; this._interactHeld = 0; this._interactDone = false; this.interactProgress = 0;
    }
  };

  Player.prototype._doorAction = function (door, slow) {
    const g = C.SoundSystem.graph;
    const portal = g.getPortal(door.portalId);
    const opening = !g.isPassable(portal);
    g.setPortalState(portal, opening ? C.PortalState.Open : C.PortalState.Closed);
    const L = C.Config.loudness;
    const loud = opening ? (slow ? L.doorOpenSlow : L.doorOpenFast)
                         : (slow ? L.doorCloseSlow : L.doorCloseFast);
    this.lastAction = (opening ? '开' : '关') + (door.kind === 'window' ? '窗' : '门') + (slow ? '（缓慢）' : '（快速）');
    C.SoundSystem.emit({
      worldPosition: C.AABB.center(door.box), loudness: loud,
      category: C.SoundCategory.Door, emitterId: this.id, label: this.lastAction
    });
  };

  // ── 投掷（主文档 4.4）──────────────────────────────
  Player.prototype._updateThrow = function (dt, input) {
    const T = C.Config.throwing;
    if (input.throwHeld && this.stones > 0) {
      this.charge = M.clamp(this.charge + dt / T.chargeSeconds, 0, 1);
    } else if (this.charge > 0) {
      if (this.stones > 0) {
        const speed = M.lerp(T.speedMin, T.speedMax, this.charge);
        C.Projectiles.spawn(this.eyePos(), this.aimDir(), speed, this.id);
        this.stones--;
        this.lastAction = '投石';
      }
      this.charge = 0;
    }
  };

  Player.prototype.aimDir = function () {
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  };

  /** 落点预测弧线（按住时显示） */
  Player.prototype.predictArc = function () {
    const T = C.Config.throwing;
    const speed = M.lerp(T.speedMin, T.speedMax, this.charge);
    return C.Projectiles.simulate(this.eyePos(), this.aimDir(), speed, this.world, T.arcSamples);
  };

  Player.prototype.die = function (cause) {
    if (!this.alive) return;
    this.alive = false;
    C.EventBus.publish(C.Events.PlayerDied, { cause });
  };

  // ── 投掷物 ─────────────────────────────────────────
  C.Projectiles = {
    list: [],
    world: null,
    init(world) { this.world = world; this.list.length = 0; },
    spawn(pos, dir, speed, ownerId) {
      this.list.push({
        pos: V.copy(pos), vel: V.scale(dir, speed), ownerId, life: 6,
        trail: [V.copy(pos)]
      });
    },
    update(dt) {
      const g = C.Config.throwing.gravity;
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        p.vel.y -= g * dt;
        const next = V.add(p.pos, V.scale(p.vel, dt));
        if (this._hit(p.pos, next)) {
          C.SoundSystem.emit({
            worldPosition: next, loudness: C.Config.loudness.stoneImpact,
            category: C.SoundCategory.Impact, emitterId: -1, label: '石头落地'
          });
          this.list.splice(i, 1);
          continue;
        }
        p.pos = next;
        p.trail.push(V.copy(next));
        if (p.trail.length > 30) p.trail.shift();
        p.life -= dt;
        if (p.life <= 0) this.list.splice(i, 1);
      }
    },
    _hit(a, b) {
      const w = this.world, tmp = [];
      w.query(Math.min(a.x, b.x) - 0.2, Math.min(a.z, b.z) - 0.2, Math.max(a.x, b.x) + 0.2, Math.max(a.z, b.z) + 0.2, tmp);
      for (const s of tmp) if (C.AABB.segmentIntersects(s.box, a, b)) return true;
      return false;
    },
    /** 纯预测，不产生副作用 */
    simulate(pos, dir, speed, world, samples) {
      const g = C.Config.throwing.gravity, dt = 0.06;
      let p = V.copy(pos), v = V.scale(dir, speed);
      const pts = [V.copy(p)];
      for (let i = 0; i < samples; i++) {
        v = { x: v.x, y: v.y - g * dt, z: v.z };
        const n = V.add(p, V.scale(v, dt));
        const tmp = [];
        world.query(Math.min(p.x, n.x) - 0.2, Math.min(p.z, n.z) - 0.2, Math.max(p.x, n.x) + 0.2, Math.max(p.z, n.z) + 0.2, tmp);
        let hit = false;
        for (const s of tmp) if (C.AABB.segmentIntersects(s.box, p, n)) { hit = true; break; }
        pts.push(V.copy(n));
        p = n;
        if (hit) break;
      }
      return pts;
    }
  };

  C.Player = Player;
  C.PLAYER_ID = PLAYER_ID;
})(typeof globalThis !== 'undefined' ? globalThis : this);
