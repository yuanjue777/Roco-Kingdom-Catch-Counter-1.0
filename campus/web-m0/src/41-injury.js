/*
 * 41-injury.js —— 出血 · 骨折 · 感染
 *
 * **吃喝不回血**（§5）—— 所以受伤是一个要养好几天的状态，
 * 不是一场战斗内的资源。这一条比任何伤害数值都更能让玩家不愿意开打。
 *
 * 三种伤势的性格完全不同，这是有意的：
 *   出血  —— 立刻、可逆、便宜（一卷绷带）。**它是「战斗有代价」的日常提醒。**
 *   骨折  —— 立刻、难逆、昂贵（四天或一副夹板）。**它惩罚的是跌落，不是战斗。**
 *   感染  —— 延迟 30 小时才发作，只有抗生素能治。**它是全游戏最致命的死因。**
 *
 * 第 2 层：只认游戏小时，不认帧、不认渲染。
 * 所有可被特性影响的数都走管线（`injury.*`），本层不认识「角色」这回事。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const M = C.M;

  const Injury = {
    bleedHours: 0,        // 还要流多久血
    fractured: false,
    fractureHours: 0,     // 还要多久长好
    splinted: false,
    infected: false,
    infectionHours: 0,    // 距离发作还有多久；<= 0 = 已发作
    ownerId: 0,

    reset(ownerId) {
      this.ownerId = ownerId === undefined ? 0 : ownerId;
      this.bleedHours = 0;
      this.fractured = false; this.fractureHours = 0; this.splinted = false;
      this.infected = false; this.infectionHours = 0;
      return this;
    },

    /* ── 受伤入口 ─────────────────────────────────── */

    /**
     * 被咬。**这是感染的唯一来源** —— 所以「被抓住」才是这个游戏真正的死因，
     * 而不是掉血。
     * @returns {damage, bleeding, infected}
     */
    bite(needs, rawDamage, rng) {
      const I = C.Config.injury;
      const dmg = C.ModifierPipeline.query('injury.bite_damage', rawDamage, this.ownerId);
      needs.damage(dmg, '被咬');
      this.bleedHours = Math.max(this.bleedHours, I.bleedHoursFromBite);

      let got = false;
      if (!this.infected) {
        const chance = C.ModifierPipeline.query('injury.infection_chance', I.infectionChance, this.ownerId);
        if ((rng ? rng.next() : Math.random()) < chance) {
          this.infected = true;
          this.infectionHours = I.incubationHours;
          got = true;
          C.EventBus.publish('InfectedEvent', {});
        }
      }
      C.EventBus.publish('WoundedEvent', { damage: dmg, bleeding: true, infected: got });
      return { damage: dmg, bleeding: true, infected: got };
    },

    /** 跌落。**骨折惩罚的是跌落，不是战斗** —— 走屋顶抄近路的代价在这里。 */
    fall(needs, height, rng) {
      const I = C.Config.injury;
      if (height < I.fallFractureHeight) return { damage: 0, fractured: false };
      const dmg = Math.round((height - I.fallFractureHeight) * 8 + 6);
      needs.damage(dmg, '摔伤');
      let broke = false;
      if (!this.fractured && (rng ? rng.next() : Math.random()) < I.fallFractureChance) {
        broke = true; this.fracture();
      }
      return { damage: dmg, fractured: broke };
    },

    fracture() {
      if (this.fractured) return false;
      this.fractured = true; this.splinted = false;
      this.fractureHours = C.Config.injury.fractureHealHours;
      C.EventBus.publish('FracturedEvent', {});
      return true;
    },

    /* ── 治疗 ─────────────────────────────────────── */

    /** 绷带：止血 + 一点回血。**这是「吃喝不回血」的唯一日常出口。** */
    bandage(needs) {
      const I = C.Config.injury;
      if (this.bleedHours <= 0) return { ok: false, msg: '没有在流血' };
      const power = C.ModifierPipeline.query('injury.bandage_power', I.bandagePower, this.ownerId);
      this.bleedHours = Math.max(0, this.bleedHours - power);
      needs.heal(C.ModifierPipeline.query('injury.bandage_heal', I.healPerBandage, this.ownerId));
      return { ok: true, msg: this.bleedHours > 0 ? '血止住一些，还在渗' : '血止住了' };
    },
    splint() {
      if (!this.fractured) return { ok: false, msg: '没有骨折' };
      if (this.splinted) return { ok: false, msg: '已经上过夹板了' };
      this.splinted = true;
      this.fractureHours *= C.Config.injury.splintHealMul;
      return { ok: true, msg: '上了夹板 —— 还是得养，但快多了' };
    },
    /**
     * 抗生素。**不是必成功的** —— 15% 的失败率意味着
     * 「我有一支抗生素」不等于「我安全了」，玩家仍然要避免被咬。
     */
    antibiotic(rng) {
      if (!this.infected) return { ok: false, msg: '没有感染' };
      const p = C.ModifierPipeline.query('injury.cure_chance', C.Config.injury.antibioticCureChance, this.ownerId);
      if ((rng ? rng.next() : Math.random()) < p) {
        this.infected = false; this.infectionHours = 0;
        C.EventBus.publish('CuredEvent', {});
        return { ok: true, msg: '压下去了' };
      }
      return { ok: false, msg: '没压住 —— 还得再来一支' };
    },

    /* ── 逐小时推进 ─────────────────────────────────
       全部按游戏小时算，睡觉时时间加速 90 倍也一样成立。 */
    update(dtHours, needs) {
      if (dtHours <= 0 || needs.dead) return;
      const I = C.Config.injury;

      if (this.bleedHours > 0) {
        const rate = C.ModifierPipeline.query('injury.bleed_rate', I.bleedPerHour, this.ownerId);
        needs.damage(rate * Math.min(dtHours, this.bleedHours), '失血过多');
        this.bleedHours = Math.max(0, this.bleedHours - dtHours);
      }
      if (this.fractured) {
        this.fractureHours = Math.max(0, this.fractureHours - dtHours);
        if (this.fractureHours <= 0) { this.fractured = false; this.splinted = false; }
      }
      if (this.infected) {
        /* `[实测]` **一次 update 可能跨过潜伏期结束的那一刻。**
           写成 `if 潜伏中 else 掉血` 的话，睡一觉（8 小时、时间 ×90）
           或者任何一次大步长都会把发作后的伤害整段吞掉 ——
           玩家睡醒发现自己一滴血没掉，然后以为感染是假的。
           和烹饪的阶段推进（30-cooking）是同一类错误：
           **跨越边界的那一步，两边都要结算。** */
        let hours = dtHours;
        if (this.infectionHours > 0) {
          const used = Math.min(hours, this.infectionHours);
          this.infectionHours -= used;
          hours -= used;
          if (this.infectionHours <= 0) C.EventBus.publish('InfectionOnsetEvent', {});
        }
        if (hours > 0) needs.damage(I.infectedHealthPerHour * hours, '感染');
      }
    },

    /** 移动速度倍率（骨折）。走管线，这样「腿伤」特性和骨折能叠。 */
    speedMul() {
      return this.fractured
        ? (this.splinted ? (1 + C.Config.injury.fractureSpeedMul) / 2 : C.Config.injury.fractureSpeedMul)
        : 1;
    },
    staminaMul() { return this.fractured && !this.splinted ? C.Config.injury.fractureStaminaMul : 1; },

    /** 界面直接显示这几行 */
    lines() {
      const out = [];
      if (this.bleedHours > 0) out.push({ kind: 'bleed', text: '流血中（还有 ' + this.bleedHours.toFixed(1) + ' 小时）' });
      if (this.fractured) out.push({ kind: 'fracture',
        text: '骨折' + (this.splinted ? '（已上夹板）' : '') + '　还要 ' + this.fractureHours.toFixed(0) + ' 小时' });
      if (this.infected) out.push({ kind: 'infect',
        text: this.infectionHours > 0
          ? '感染潜伏期　还有 ' + this.infectionHours.toFixed(0) + ' 小时发作'
          : '**已发作** —— 每小时掉 ' + C.Config.injury.infectedHealthPerHour + ' 点，只有抗生素能治' });
      return out;
    },

    serialize() {
      return { bleedHours: this.bleedHours, fractured: this.fractured, fractureHours: this.fractureHours,
               splinted: this.splinted, infected: this.infected, infectionHours: this.infectionHours };
    },
    deserialize(d) {
      if (!d) return this;
      this.bleedHours = d.bleedHours || 0;
      this.fractured = !!d.fractured; this.fractureHours = d.fractureHours || 0;
      this.splinted = !!d.splinted;
      this.infected = !!d.infected; this.infectionHours = d.infectionHours || 0;
      return this;
    }
  };

  C.Injury = Injury;
})(typeof globalThis !== 'undefined' ? globalThis : this);
