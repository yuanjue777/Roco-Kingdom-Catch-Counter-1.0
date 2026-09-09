/*
 * 40-combat.js —— 近战 · 抓取 · 处决
 *
 * **战斗不是解法，是失败的代价。**
 * 近战响度 55 比追击低吼（55）还响 —— 你能杀掉第一只，第三只会杀掉你。
 *
 * 这个文件的核心判断只有一条：
 *
 *   **单体威胁来自「退不掉」，不是「打得疼」。**
 *
 * 游荡者追击 2.7 m/s < 玩家奔跑 4.6 m/s —— 玩家永远能退。
 * 所以把单体伤害调到 50 也没用，只会得到「一对一绝对安全、一对多瞬间暴毙」
 * 的断崖，中间没有过渡。真正的威胁是**抓取**：它本身伤害不高（14），
 * 危险在于**它把你钉在原地 4 秒，并且让你大声呼痛（60），
 * 而那 4 秒足够别的丧尸赶到。**
 *
 * 这条天然实现了「前期怪少后期怪多」的难度曲线，而且不用改任何数值：
 *   第 3 天走廊里就一只 → 被抓住是惊险
 *   第 20 天同一条走廊六只 → 被抓住是死刑
 *
 * 第 3–4 层。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const V = C.V, M = C.M;

  const Combat = {
    /** 玩家当前被谁抓着：{ zombie, kind, until, struggle, nextBite, nextCry } */
    grabbedBy: null,
    /** 倒地剩余秒数（蜷伏者/奔行者会打倒你） */
    downFor: 0,
    /** 手里武器的耐久：weaponId → 剩余 */
    durability: {},
    swing: null,          // 挥击中：{ weaponId, at, until }
    /* 战斗全部按**真实秒**计时（抬手 0.4s、抓住 4s），不是游戏小时。
       自己维护一个单调时钟，别去借 SoundSystem 或 TimeSystem 的 —— 那两个
       一个是游戏内时间（会 ×90 加速），一个根本没有 `now`。 */
    t: 0,

    reset() {
      this.grabbedBy = null; this.downFor = 0; this.durability = {}; this.swing = null;
      this.t = 0;
      return this;
    },

    /* ── 武器 ──────────────────────────────────────── */

    /** 玩家手里那把（快取位里第一件武器，没有就是徒手） */
    weaponOf(player) {
      const W = C.Config.combat.weapons;
      for (const it of player.hotbar) if (it && W[it.id]) return { id: it.id, def: W[it.id], item: it };
      if (player.bag) {
        for (const it of player.bag.items) if (W[it.id]) return { id: it.id, def: W[it.id], item: it };
      }
      return { id: 'fist', def: W.fist, item: null };
    },
    /** 剩余耐久（徒手是 Infinity） */
    durabilityOf(w) {
      if (!w.def.durability) return Infinity;
      if (this.durability[w.id] === undefined) this.durability[w.id] = w.def.durability;
      return this.durability[w.id];
    },
    _spend(w, player, amount) {
      if (!w.def.durability) return;
      const cost = C.ModifierPipeline.query('combat.durability_cost', amount, player.id);
      this.durability[w.id] = Math.max(0, this.durabilityOf(w) - cost);
      if (this.durability[w.id] <= 0) {
        if (w.item) player._removeItem(w.item);
        delete this.durability[w.id];
        C.EventBus.publish('WeaponBrokeEvent', { weaponId: w.id });
        return true;      // 断了
      }
      return false;
    },

    /* ── 挥击 ──────────────────────────────────────── */

    /**
     * 挥一下。**慢攻速给的是玩家的容错，不是丧尸的** ——
     * `windup` 期间玩家不能移动也不能取消，所以「什么时候挥」本身是个决定。
     */
    attack(player, zombies) {
      const nowSeconds = this.t;
      if (this.grabbedBy) return { ok: false, msg: '被抓住了，先挣脱' };
      if (this.downFor > 0) return { ok: false, msg: '倒在地上' };
      if (this.swing) return { ok: false, msg: '还在收手' };
      if (player.stamina < C.Config.combat.hitStaminaCost) return { ok: false, msg: '没力气了' };

      const w = this.weaponOf(player);
      // 背后偷袭优先：**处决是战斗在这个游戏里唯一合理的主动用法**
      const exec = this._findExecuteTarget(player, zombies, w);
      if (exec) return this._execute(player, exec, w);

      this.swing = { weaponId: w.id, at: nowSeconds, until: nowSeconds + w.def.windup, done: false };
      player.stamina -= C.Config.combat.hitStaminaCost;
      return { ok: true, msg: '挥出' + w.def.name, windup: w.def.windup };
    },

    /** 抬手结束的那一帧结算命中 */
    update(dt, player, zombies) {
      this.t += dt;
      const nowSeconds = this.t;
      // 倒地
      if (this.downFor > 0) {
        this.downFor = Math.max(0, this.downFor - dt);
        if (this.downFor === 0) {
          C.SoundSystem.emit({ worldPosition: player.pos, loudness: C.Config.combat.getUpLoudness,
                               category: C.SoundCategory.Impact, emitterId: player.id, label: '爬起来' });
        }
      }
      // 被抓住
      if (this.grabbedBy) this._updateGrab(dt, player, nowSeconds);
      // 挥击结算
      if (this.swing && !this.swing.done && nowSeconds >= this.swing.until) {
        this.swing.done = true;
        this._resolveHit(player, zombies, this.swing.weaponId);
      }
      if (this.swing && nowSeconds >= this.swing.until + 0.15) this.swing = null;
    },

    _resolveHit(player, zombies, weaponId) {
      const W = C.Config.combat.weapons[weaponId] || C.Config.combat.weapons.fist;
      const w = { id: weaponId, def: W, item: this.weaponOf(player).item };
      const reach = W.reach || C.Config.combat.meleeRange;
      const eye = player.eyePos();
      const fwd = { x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) };

      let best = null, bd = reach;
      for (const z of zombies) {
        if (!z.alive) continue;
        const to = V.sub(z.pos, player.pos);
        const d = Math.hypot(to.x, to.z);
        if (d > bd || Math.abs(z.pos.y - player.pos.y) > 1.6) continue;
        const dot = (to.x / (d || 1)) * fwd.x + (to.z / (d || 1)) * fwd.z;
        if (dot < 0.35) continue;
        bd = d; best = z;
      }

      // **挥空也响。** 否则玩家会用「反正没打中」来免费试探
      const loud = C.ModifierPipeline.query('sound.melee', W.loud, player.id);
      C.SoundSystem.emit({ worldPosition: player.pos, loudness: loud, category: C.SoundCategory.Impact,
                           emitterId: player.id, label: best ? '挥击命中' : '挥空' });
      if (!best) { player.lastAction = '挥空了'; return { ok: false, msg: '挥空了' }; }

      const dmg = C.ModifierPipeline.query('combat.melee_damage', W.damage, player.id);
      best.hp -= dmg;
      const broke = this._spend(w, player, 1);
      if (best.hp <= 0) {
        best.die ? best.die() : (best.alive = false);
        C.EventBus.publish('ZombieKilledEvent', { zombie: best, weaponId });
        // 打死的那一只如果正抓着你，抓取一起解除
        if (this.grabbedBy && this.grabbedBy.zombie === best) this.release(player, '打死了它');
      }
      player.lastAction = '打中' + (best.def ? best.def.name : '丧尸') + (best.hp <= 0 ? ' —— 倒下了' : '');
      return { ok: true, damage: dmg, killed: best.hp <= 0, broke };
    },

    /* ── 处决 ──────────────────────────────────────── */

    _findExecuteTarget(player, zombies, w) {
      if (!w.def.exec) return null;
      const E = C.Config.combat.execute;
      const fwd = { x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) };
      for (const z of zombies) {
        if (!z.alive) continue;
        /* **必须是它没察觉你的时候。** 一旦进入警觉/调查/追击，背后偷袭就不算数 ——
           否则「绕到背后处决」会变成对付任何一只丧尸的万能解。
           状态是中文枚举（见 11-zombie 的 `State`），这里按「安全状态白名单」判，
           **不要列黑名单** —— 以后加了新状态，白名单会自动把它当成危险的。 */
        if (z.state !== '游荡' && z.state !== '趴伏') continue;
        const to = V.sub(z.pos, player.pos);
        const d = Math.hypot(to.x, to.z);
        if (d > E.range || Math.abs(z.pos.y - player.pos.y) > 1.2) continue;
        if ((to.x / (d || 1)) * fwd.x + (to.z / (d || 1)) * fwd.z < 0.35) continue;
        // 它的朝向和「它到你」的方向同向 = 你在它背后
        const zf = { x: -Math.sin(z.yaw), z: -Math.cos(z.yaw) };
        const away = { x: -to.x / (d || 1), z: -to.z / (d || 1) };
        if (zf.x * away.x + zf.z * away.z > E.behindDot) continue;
        return z;
      }
      return null;
    },

    _execute(player, z, w) {
      const E = C.Config.combat.execute;
      player.stamina -= E.staminaCost;
      z.hp = 0;
      z.die ? z.die() : (z.alive = false);
      this._spend(w, player, E.durabilityCost);
      /* 响度只有 30 —— 这是战斗唯一一次**比它引来的麻烦更划算**的时候。
         对比：正常挥击 55，够把半层楼的丧尸叫过来。 */
      C.SoundSystem.emit({ worldPosition: player.pos, loudness: E.loud, category: C.SoundCategory.Impact,
                           emitterId: player.id, label: '处决' });
      C.EventBus.publish('ZombieKilledEvent', { zombie: z, weaponId: w.id, execute: true });
      player.lastAction = '处决';
      return { ok: true, execute: true, msg: '处决' };
    },

    /* ── 抓取 ──────────────────────────────────────── */

    /** 丧尸贴身时调用。返回是否抓住了 */
    tryGrab(z, player) {
      const nowSeconds = this.t;
      if (this.grabbedBy || !player.alive) return false;
      if (C.Config.debug.godMode) return false;
      if (z._grabCd && nowSeconds < z._grabCd) return false;
      const G = C.Config.combat.grab;
      const g = C.Config.combat.grabs[z.typeName] || C.Config.combat.grabs.Wanderer;
      this.grabbedBy = {
        zombie: z, kind: z.typeName, g,
        until: nowSeconds + g.hold,
        struggle: 0, nextBite: nowSeconds + G.biteInterval, nextCry: nowSeconds
      };
      if (g.knockdown > 0) this.downFor = Math.max(this.downFor, g.knockdown);
      player.lastAction = (z.def ? z.def.name : '丧尸') + g.label;
      C.EventBus.publish('GrabbedEvent', { zombie: z, label: g.label });
      return true;
    },

    /** 玩家按挣脱键。**连打才有用** —— 不按的时候进度会衰减 */
    struggle(player) {
      const gb = this.grabbedBy;
      if (!gb) return { ok: false, msg: '没有被抓住' };
      const G = C.Config.combat.grab;
      let gain = G.struggleGain;
      // 没体力就挣不动 —— **体力管理直接决定生死，这是它最锋利的一次体现**
      if (player.stamina < G.struggleCost) gain *= G.exhaustedGainMul;
      else player.stamina -= G.struggleCost;
      gb.struggle = Math.min(100, gb.struggle + gain);
      if (gb.struggle >= 100) { this.release(player, '挣脱了'); return { ok: true, free: true, msg: '挣脱了' }; }
      return { ok: true, free: false, progress: gb.struggle };
    },

    release(player, why) {
      const gb = this.grabbedBy;
      if (!gb) return;
      // 冷却挂在那只丧尸身上，防止它松手的下一帧又抓住
      gb.zombie._grabCd = this.t + C.Config.combat.grab.cooldown;
      this.grabbedBy = null;
      if (why) player.lastAction = why;
      C.EventBus.publish('ReleasedEvent', { why });
    },

    _updateGrab(dt, player, nowSeconds) {
      const gb = this.grabbedBy, G = C.Config.combat.grab;
      gb.struggle = Math.max(0, gb.struggle - G.struggleDecay * dt);

      /* **呼痛响度 60，每秒一次。** 这才是抓取真正的杀伤力：
         它不是在扣血，是在把整层楼的丧尸叫到你身上。 */
      if (nowSeconds >= gb.nextCry) {
        gb.nextCry = nowSeconds + G.cryInterval;
        const cry = C.ModifierPipeline.query('injury.cry_loudness', G.cryLoudness, player.id);
        C.SoundSystem.emit({ worldPosition: player.pos, loudness: cry,
                             category: C.SoundCategory.Voice, emitterId: player.id, label: '呼痛' });
      }
      if (nowSeconds >= gb.nextBite) {
        gb.nextBite = nowSeconds + G.biteInterval;
        C.Injury.bite(player.needs, gb.g.bite, player.rng);
        if (player.needs.dead) { player.die('被' + (gb.zombie.def ? gb.zombie.def.name : '丧尸') + '咬死'); return; }
      }
      // 抓不住那么久也会松手 —— 这就是「容错窗口」的长度
      if (nowSeconds >= gb.until) this.release(player, '它松开了');
    },

    /** 被抓住/倒地时移动速度的倍率（装配层乘上去） */
    moveMul() {
      if (this.grabbedBy || this.downFor > 0) return C.Config.combat.knockdownSpeedMul;
      if (this.swing) return 0.35;      // 抬手期间几乎不能动
      return 1;
    },

    serialize() {
      return { durability: this.durability, downFor: this.downFor };
    },
    deserialize(d) {
      if (!d) return this;
      this.durability = d.durability || {};
      this.downFor = d.downFor || 0;
      this.grabbedBy = null; this.swing = null;   // 读档不该还被抓着
      return this;
    }
  };

  C.Combat = Combat;
})(typeof globalThis !== 'undefined' ? globalThis : this);
