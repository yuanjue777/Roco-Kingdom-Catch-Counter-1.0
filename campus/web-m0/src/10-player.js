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
    this.velY = 0; this.airborne = false; this._coyote = 0; this._jumpPrev = false;
    this.vault = null;                // 翻越中的插值状态
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
    // 扇区宽度直接就是这次的方向不确定度：听觉越好，扇区越窄
    const spread = Math.max(8 * M.deg2rad, err);
    const trueAngle = Math.atan2(info.dir.x, info.dir.z);
    this.soundprints.push({
      // 透视标记用真实声源位置；方向指示仍按规格 5.4 用路径入口方向，两者互不干扰
      src: C.Config.hearing.revealSource ? V.copy(info.evt.worldPosition) : null,
      fromZombie: info.evt.emitterId >= 100,
      angle: trueAngle + offset, spread,
      category: info.evt.category,
      band: C.Reaction.distanceBand(info.margin),
      margin: info.margin,
      born: performance.now() / 1000,
      evtId: info.evt.id
    });
    if (this.soundprints.length > 24) this.soundprints.shift();
  };

  /** 单击贴墙：背贴墙面，视角切第三人称（渲染层据此切换），仍可投掷 */
  Player.prototype.toggleWallHug = function () {
    if (this.wallHug) { this.wallHug = false; this.wallNormal = null; this.lastAction = '离开墙面'; return; }
    const w = this.world.probeWall(this.pos, 1.5, C.Config.player.wallProbeDistance);
    if (!w) { this.lastAction = '附近没有可贴的墙'; return; }
    this.wallHug = true; this.wallNormal = w.normal;
    /* 身体背贴墙，但朝向取「沿墙走向」中与当前朝向更接近的一侧。
       朝墙外的话在 2.6m 宽的走廊里等于脸贴对面墙，第三人称毫无用处。 */
    const n = w.normal, f = this.forwardFlat();
    const t = { x: n.z, z: -n.x };
    const dir = (f.x * t.x + f.z * t.z) >= 0 ? 1 : -1;
    this.yaw = Math.atan2(-t.x * dir, -t.z * dir);
    this.lastAction = '贴墙';
  };

  Player.prototype.eyeHeight = function () {
    const P = C.Config.player;
    return this.posture === 'crouch' ? P.eyeHeightCrouch : P.eyeHeightStand;
  };
  Player.prototype.eyePos = function () {
    const P = C.Config.player;
    const y = this.pos.y + this.eyeHeight();
    if (!this.lean) return { x: this.pos.x, y, z: this.pos.z };
    // 侧头时探出去的是脑袋：投掷起点、听觉位置、被发现判定都按探出后的位置算
    const r = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    return { x: this.pos.x + r.x * this.lean * P.leanOffset, y: y - 0.12,
             z: this.pos.z + r.z * this.lean * P.leanOffset };
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
    if (input.wallHug && !this._wallPrev) this.toggleWallHug();
    this._wallPrev = !!input.wallHug;
    if (this.wallHug) {
      /* 离开墙面就自动解除。必须认准进入时那面墙：走廊只有 2.6m 宽，
         任何位置都离某面墙不到 1.35m，只判「附近有没有墙」的话永远解除不了。 */
      const w = this.world.probeWall(this.pos, 1.5, P.wallExitDistance);
      const same = w && this.wallNormal &&
        (w.normal.x * this.wallNormal.x + w.normal.z * this.wallNormal.z) > 0.7;
      if (!same) { this.wallHug = false; this.wallNormal = null; }
    }
    this.running = input.run && !input.crouch && !this.holdBreath && !this.wallHug && this.stamina > 0;
    if (this.wallHug) this.lean = 0;   // 贴墙时整个人已经在掩体后，探头交给第三人称视角

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
    if (this.lean !== 0 && !this.wallHug) speed = 0;   // 侧身探头时移动速度为 0（贴墙时仍可沿墙挪）
    if (this.exhausted) speed *= S.exhaustedSpeedMul;

    // ── 移动 ──────────────────────────────────────────
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = input.right * cos - input.forward * sin;
    let mz = -input.right * sin - input.forward * cos;
    // 只在超过 1 时归一化：键盘斜向走(√2)被压回 1，触屏摇杆的模拟量(0~1)得以保留
    const mlen = Math.hypot(mx, mz);
    if (mlen > 1) { mx /= mlen; mz /= mlen; } else if (mlen < 1e-3) { mx = mz = 0; }
    const mag = Math.min(mlen, 1);            // 摇杆推到几分，速度就是几分
    if (this.wallHug && this.wallNormal) {
      // 贴墙时把移动投影到墙面上
      const d = mx * this.wallNormal.x + mz * this.wallNormal.z;
      mx -= d * this.wallNormal.x; mz -= d * this.wallNormal.z;
    }
    // 跳跃/翻越是边沿触发：按住不放不会连跳
    if (input.jump && !this._jumpPrev) this.tryJump();
    this._jumpPrev = !!input.jump;

    this._move(dt, mx, mz, speed, mag);

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
    if (this.moving && !this.holdBreath && !this.airborne && !this.vault) {
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

  /** 水平与垂直分开处理：跳跃与下落需要独立的 y 轴积分，不能每帧硬吸附到地面 */
  Player.prototype._move = function (dt, mx, mz, speed, mag) {
    const P = C.Config.player, W = this.world;

    // 翻越中：忽略输入，沿插值轨迹走完，中途不可打断
    if (this.vault) {
      this.vault.t += dt;
      const k = M.clamp(this.vault.t / this.vault.dur, 0, 1);
      const e = k * k * (3 - 2 * k);
      this.pos.x = M.lerp(this.vault.from.x, this.vault.to.x, e);
      this.pos.z = M.lerp(this.vault.from.z, this.vault.to.z, e);
      this.pos.y = M.lerp(this.vault.from.y, this.vault.to.y, e) + Math.sin(k * Math.PI) * P.vaultLift;
      this.moving = true; this.speedNow = 0;
      if (k >= 1) { this.pos.y = this.vault.to.y; this.vault = null; this.airborne = false; this.velY = 0; }
      return;
    }

    const ctl = this.airborne ? P.airControlMul : 1;
    this.moving = (mx !== 0 || mz !== 0) && speed > 0.01;
    this.speedNow = this.moving ? speed * mag : 0;
    if (this.moving) W.moveHorizontal(this.pos, mx * speed * ctl * dt, mz * speed * ctl * dt, P.radius, 1.7, P.stepHeight);

    if (this.airborne) {
      this.velY -= P.gravity * dt;
      let ny = this.pos.y + this.velY * dt;
      const ceil = W.ceilingY(this.pos, this.pos.y + 1.2, P.radius);
      if (ceil !== null && ny + 1.75 > ceil) { ny = Math.min(ny, ceil - 1.75); this.velY = Math.min(0, this.velY); }
      const ground = W.groundY(this.pos, this.pos.y + 0.02, P.radius);
      if (this.velY <= 0 && ground !== null && ny <= ground) {
        ny = ground; this.airborne = false; this.velY = 0; this._onLand();
      }
      this.pos.y = ny;
      this._coyote = 0;
    } else {
      const ground = W.groundY(this.pos, this.pos.y + P.stepHeight, P.radius);
      if (ground === null) { this.airborne = true; this.velY = 0; this._fallFrom = this.pos.y; }
      else { this.pos.y = ground; this._coyote = P.coyoteTime; this._fallFrom = ground; }
    }
  };

  Player.prototype._onLand = function () {
    // 落地有声。跳跃本身文档里没有，落地响度也是文档外的新增值。
    const drop = (this._fallFrom || this.pos.y) - this.pos.y;
    if (drop > 0.15 || this._jumped) {
      this.emit(C.ModifierPipeline.query('sound.footstep', C.Config.loudness.jumpLand, this.id),
                C.SoundCategory.Impact, '落地');
    }
    this._jumped = false;
  };

  Player.prototype.forwardFlat = function () {
    return { x: -Math.sin(this.yaw), y: 0, z: -Math.cos(this.yaw) };
  };

  /**
   * 跳跃键：先看正前方有没有可翻越的边缘，有就翻越，没有才起跳。
   * 「贴住前方有障碍物时按跳跃会自动攀爬」就是这个优先级。
   */
  Player.prototype.tryJump = function () {
    if (!this.alive || this.vault) return;
    const P = C.Config.player;
    const v = this.world.probeVault(this.pos, this.forwardFlat(), P.radius, P);
    if (v) {
      const cost = C.ModifierPipeline.query('stamina.climb_cost', P.stamina.climbCost, this.id);
      if (this.stamina < cost) { this.lastAction = '体力不足，翻不上去'; return; }
      this.stamina -= cost;
      this.vault = { t: 0, dur: P.vaultDuration, from: V.copy(this.pos), to: v.target };
      this.vaultRise = v.rise;
      this.lastAction = '翻越 ' + v.rise.toFixed(2) + 'm';
      // 翻窗(完好窗) 响度 30 —— 声音规格 6.1
      this.emit(C.ModifierPipeline.query('sound.footstep', C.Config.loudness.windowClimb, this.id),
                C.SoundCategory.Impact, '翻越');
      return;
    }
    if (this.airborne && this._coyote <= 0) return;
    const cost = C.ModifierPipeline.query('stamina.jump_cost', P.stamina.jumpCost, this.id);
    if (this.stamina < cost) { this.lastAction = '体力不足，跳不动'; return; }
    this.stamina -= cost;
    this.airborne = true; this.velY = P.jumpSpeed; this._coyote = 0;
    this._fallFrom = this.pos.y; this._jumped = true;
    this.lastAction = '跳跃';
  };

  /** 正前方是否有可翻越的边缘（HUD 用来提示「按跳跃可翻越」） */
  Player.prototype.vaultTarget = function () {
    if (this.vault || this.airborne) return null;
    return this.world.probeVault(this.pos, this.forwardFlat(), C.Config.player.radius, C.Config.player);
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
    /* 第三人称时相机不在眼位上，若直接按 yaw/pitch 投掷，准星与落点会横着差开一截。
       装配层每帧把「准星指向的那个远点」写进 aimTarget，这里改为朝那个点投。 */
    if (this.aimTarget) return V.norm(V.sub(this.aimTarget, this.eyePos()));
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  };

  /**
   * 投掷预测：弹道 + 落点 + 该落点的引怪半径。
   * 引怪半径 = (落地响度 − 丧尸阈值) / k，k 取落点所在节点（室内 2.0 / 室外 1.2）并乘夜间系数。
   * 注意这是**路径长度**半径，不是直线半径 —— 隔着墙和门实际会短很多，圆圈只是同一空间内的上界。
   */
  Player.prototype.predictThrow = function () {
    const T = C.Config.throwing;
    const speed = M.lerp(T.speedMin, T.speedMax, this.charge);
    const points = C.Projectiles.simulate(this.eyePos(), this.aimDir(), speed, this.world, T.arcSamples);
    const impact = points[points.length - 1];
    const node = C.SoundSystem.graph.getNodeAt(impact);
    const k = C.SoundSystem.kFor(node);
    const loud = C.Config.loudness.stoneImpact;
    return {
      points, impact, node,
      loudness: loud,
      radius: Math.max(0, (loud - C.Config.hearing.zombie) / k)
    };
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
    FIXED: 0.04,          // 预览与实弹必须用同一个步长，否则预测的落点不是真落点
    _acc: 0,
    init(world) { this.world = world; this.list.length = 0; this._acc = 0; },
    spawn(pos, dir, speed, ownerId) {
      this.list.push({ pos: V.copy(pos), vel: V.scale(dir, speed), ownerId, life: 6, trail: [V.copy(pos)] });
    },
    /** 一步积分：先加重力再位移，预览与实弹保持完全一致的顺序 */
    _step(pos, vel, dt) {
      const v = { x: vel.x, y: vel.y - C.Config.throwing.gravity * dt, z: vel.z };
      return { pos: V.add(pos, V.scale(v, dt)), vel: v };
    },
    update(dt) {
      this._acc += dt;
      let guard = 20;
      while (this._acc >= this.FIXED && guard-- > 0) {
        this._acc -= this.FIXED;
        this._tick(this.FIXED);
      }
    },
    _tick(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        const r = this._step(p.pos, p.vel, dt);
        if (this._hit(p.pos, r.pos)) {
          C.SoundSystem.emit({
            worldPosition: this.contact(p.pos, r.pos), loudness: C.Config.loudness.stoneImpact,
            category: C.SoundCategory.Impact, emitterId: -1, label: '石头落地'
          });
          this.list.splice(i, 1);
          continue;
        }
        p.pos = r.pos; p.vel = r.vel;
        p.trail.push(V.copy(r.pos));
        if (p.trail.length > 30) p.trail.shift();
        p.life -= dt;
        if (p.life <= 0) this.list.splice(i, 1);
      }
    },
    /** 二分出最后一个未接触的点，保证落点留在被撞面的正确一侧 */
    contact(a, b) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (this._hit(a, V.lerp(a, b, mid))) hi = mid; else lo = mid;
      }
      return V.lerp(a, b, lo);
    },
    _hit(a, b) {
      const w = this.world, tmp = [];
      w.query(Math.min(a.x, b.x) - 0.2, Math.min(a.z, b.z) - 0.2, Math.max(a.x, b.x) + 0.2, Math.max(a.z, b.z) + 0.2, tmp);
      for (const s of tmp) if (C.AABB.segmentIntersects(s.box, a, b)) return true;
      return false;
    },
    /** 纯预测，与 _tick 用同一个 _step 和同一个步长，所以落点与实弹一致 */
    simulate(pos, dir, speed, world, samples) {
      let p = V.copy(pos), v = V.scale(dir, speed);
      const pts = [V.copy(p)];
      for (let i = 0; i < samples; i++) {
        const r = this._step(p, v, this.FIXED);
        if (this._hit(p, r.pos)) { pts.push(this.contact(p, r.pos)); break; }
        pts.push(V.copy(r.pos));
        p = r.pos; v = r.vel;
      }
      return pts;
    }
  };

  C.Player = Player;
  C.PLAYER_ID = PLAYER_ID;
})(typeof globalThis !== 'undefined' ? globalThis : this);
