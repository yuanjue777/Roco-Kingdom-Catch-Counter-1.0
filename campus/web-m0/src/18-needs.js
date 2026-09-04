/*
 * 18-needs.js —— 生存需求（主文档 3.2 / 3.3）
 *
 * 生命条与体力条长度固定 100，饥饿/口渴/困乏从右端「挤占」可用上限。
 *   可用生命上限 = 100 − 饥饿挤占 − 口渴挤占
 *   可用体力上限 = 100 − 困乏挤占
 * 进食饮水立即解除挤占、立即恢复上限，但**当前生命不会因此回血** ——
 * 挤占解除只是解锁了上限，受过的伤要单独治。
 *
 * 本文件是规则层：只认游戏小时，不认帧、不认渲染。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const { M } = C;

  function Needs(ownerId) {
    const N = C.Config.needs;
    this.ownerId = ownerId;
    this.hunger = 0;            // 挤占量 0–100
    this.thirst = 0;
    this.fatigue = 0;
    this.health = N.barLength;  // 当前生命
    this.diarrheaHours = 0;     // 腹泻剩余（游戏小时）
    this.restedHours = 0;       // 精力充沛剩余
    this.dead = false;
    this.cause = '';
  }

  Needs.prototype.healthMax = function () {
    return Math.max(0, C.Config.needs.barLength - this.hunger - this.thirst);
  };
  Needs.prototype.staminaMax = function () {
    return Math.max(0, C.Config.needs.barLength - this.fatigue);
  };
  Needs.prototype.isRested = function () { return this.restedHours > 0; };

  /**
   * @param {number} dtHours 经过的游戏小时
   * @param {boolean} sleeping 是否在睡眠中
   */
  Needs.prototype.update = function (dtHours, sleeping) {
    if (this.dead || dtHours <= 0) return;
    const N = C.Config.needs, L = N.barLength;

    let thirstRate = L / N.thirstFullHours;
    if (this.diarrheaHours > 0) {
      thirstRate *= N.diarrheaThirstMul;
      this.diarrheaHours = Math.max(0, this.diarrheaHours - dtHours);
    }
    this.thirst = M.clamp(this.thirst + thirstRate * dtHours, 0, L);
    this.hunger = M.clamp(this.hunger + (L / N.hungerFullHours) * dtHours, 0, L);

    // 困乏：清醒时涨、睡眠时退。精力充沛期间涨得慢
    if (sleeping) {
      this.fatigue = M.clamp(this.fatigue - N.fatigueSleepPerHour * dtHours, 0, L);
    } else {
      let rate = N.fatigueRatePerHour;
      if (this.restedHours > 0) { rate *= N.restedFatigueMul; this.restedHours = Math.max(0, this.restedHours - dtHours); }
      this.fatigue = M.clamp(this.fatigue + rate * dtHours, 0, L);
    }

    // 挤占增长把当前生命压低 —— 这就是饿死渴死的机制
    const cap = this.healthMax();
    if (this.health > cap) this.health = cap;
    if (cap <= 0 && !this.dead) {
      this.dead = true;
      this.cause = this.thirst >= this.hunger ? '渴死' : '饿死';
    }
    C.EventBus.publish(C.Events.NeedChanged, { hunger: this.hunger, thirst: this.thirst, fatigue: this.fatigue, health: this.health });
  };

  Needs.prototype.damage = function (amount, cause) {
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0 && !this.dead) { this.dead = true; this.cause = cause || '失血过多'; }
  };
  /** 治疗只抬当前生命，抬不过当前上限 */
  Needs.prototype.heal = function (amount) {
    this.health = Math.min(this.healthMax(), this.health + amount);
  };

  /** 吃/喝。返回 {ok, msg}。rng 可注入以保证可复现（支柱三） */
  Needs.prototype.consume = function (key, rng) {
    const item = C.Config.items[key];
    if (!item) return { ok: false, msg: '没有这个东西' };
    const L = C.Config.needs.barLength;
    this.thirst = M.clamp(this.thirst + item.thirst, 0, L);
    this.hunger = M.clamp(this.hunger + item.hunger, 0, L);
    let msg = item.name;
    if (item.diarrheaChance && (rng ? rng.next() : Math.random()) < item.diarrheaChance) {
      this.diarrheaHours = C.Config.needs.diarrheaHours;
      msg += '（喝出了腹泻）';
    }
    return { ok: true, msg };
  };

  Needs.prototype.grantRested = function () { this.restedHours = C.Config.needs.restedDurationHours; };

  Needs.prototype.serialize = function () {
    return { hunger: this.hunger, thirst: this.thirst, fatigue: this.fatigue,
             health: this.health, diarrheaHours: this.diarrheaHours, restedHours: this.restedHours };
  };
  Needs.prototype.deserialize = function (d) { Object.assign(this, d); this.dead = false; };

  C.Needs = Needs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
