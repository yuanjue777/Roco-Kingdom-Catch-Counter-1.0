/*
 * 33-traits.js —— 角色与特性（角色与特性规格 v1）
 *
 * **这一层只做两件事：算点数、把修正挂上管线。**
 *
 * 规格 4.2 是硬约束：
 *   「所有特性效果必须通过 ModifierPipeline 生效，
 *     不允许在业务代码中做任何角色/特性的条件判断。」
 * 也就是说 —— **全项目搜不到一句 `if (character === 'guard')`。**
 * 角色和特性在开局把自己的 modifiers 一次性注册进管线，之后再不参与任何逻辑。
 *
 * 这条规矩的价值在改数值的时候才看得出来：调「耳背」不需要碰听觉系统，
 * 而听觉系统也永远不需要知道世界上存在「角色」这个概念。
 *
 * 第 1–2 层，不依赖渲染。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  const MOD_PREFIX = 'loadout:';        // 注册到管线时的 id 前缀，卸载时按前缀清

  const Loadout = {
    characterId: null,
    picked: [],                 // 玩家自选的特性 id
    applied: false,
    _regs: [],                  // [key, id] —— 卸载用

    /* ── 查询 ──────────────────────────────────────── */
    character() {
      return C.Config.characters.find(c => c.id === this.characterId) || null;
    },
    trait(id) { return C.Config.traits[id] || null; },
    /** 可选池：固定特性不入池（规格 1.2） */
    pool() {
      return Object.keys(C.Config.traits)
        .filter(id => !C.Config.traits[id].fixed)
        .map(id => Object.assign({ id }, C.Config.traits[id]));
    },
    fixedTraits() {
      const ch = this.character();
      if (!ch) return [];
      return ch.fixed.map(id => Object.assign({ id }, C.Config.traits[id]));
    },

    /* ── 点数 ──────────────────────────────────────────
       正向消耗等于其数值的点数，负向返还其绝对值。
       **角色的固定特性不消耗点数，也不占名额。** */
    spent() {
      let n = 0;
      for (const id of this.picked) n += this.trait(id).value;
      return n;
    },
    remaining() {
      const ch = this.character();
      return (ch ? ch.points : 0) - this.spent();
    },
    counts() {
      let pos = 0, neg = 0;
      for (const id of this.picked) (this.trait(id).value > 0 ? pos++ : neg++);
      return { pos, neg };
    },

    /** 已经被占掉的互斥组 → 组名 -> 占用它的特性 id（含角色固定特性） */
    takenGroups(exceptId) {
      const map = {};
      for (const t of this.fixedTraits()) if (t.group) map[t.group] = t.id;
      for (const id of this.picked) {
        if (id === exceptId) continue;
        const t = this.trait(id);
        if (t && t.group) map[t.group] = id;
      }
      return map;
    },

    /**
     * 这条特性现在能不能选。返回 {ok} 或 {ok:false, why}。
     * **why 要能直接显示在按钮旁边** —— 置灰而不说原因是最让人恼火的界面。
     */
    canPick(id) {
      const t = this.trait(id);
      if (!t) return { ok: false, why: '没有这条特性' };
      if (t.fixed) return { ok: false, why: '这是角色固定特性' };
      if (!this.characterId) return { ok: false, why: '先选角色' };
      if (this.picked.indexOf(id) >= 0) return { ok: false, why: '已选' };

      const R = C.Config.traitRules, c = this.counts();
      if (t.value > 0 && c.pos >= R.positiveMax) return { ok: false, why: '正向已满 ' + R.positiveMax + ' 个' };
      if (t.value < 0 && c.neg >= R.negativeMax) return { ok: false, why: '负向已满 ' + R.negativeMax + ' 个' };

      if (t.group) {
        const taken = this.takenGroups()[t.group];
        if (taken) {
          const other = this.trait(taken);
          const fixed = this.character().fixed.indexOf(taken) >= 0;
          return { ok: false, why: (fixed ? '与固定特性「' : '与已选「') + other.name + '」冲突' };
        }
      }
      /* 点数不够只挡正向。**负向永远可以选** ——
         它是用来换点数的，挡住它等于挡住整个构筑玩法。 */
      if (t.value > 0 && t.value > this.remaining()) {
        return { ok: false, why: '还差 ' + (t.value - this.remaining()) + ' 点' };
      }
      return { ok: true };
    },

    pick(id) {
      const r = this.canPick(id);
      if (!r.ok) return r;
      this.picked.push(id);
      return { ok: true };
    },
    unpick(id) {
      const i = this.picked.indexOf(id);
      if (i < 0) return { ok: false, why: '没选过' };
      /* 退掉一条负向可能让点数变成负的（正向已经花掉了）。
         这时候**不阻止，让剩余点数显示成负数** —— 玩家看得见自己欠了多少，
         比「这个按钮点不动而且不告诉你为什么」好得多。确认按钮会拦住他。 */
      this.picked.splice(i, 1);
      return { ok: true };
    },
    toggle(id) { return this.picked.indexOf(id) >= 0 ? this.unpick(id) : this.pick(id); },

    /** 能不能开始游戏。**唯一的条件：剩余点数 ≥ 0**（规格 1.2） */
    canConfirm() {
      if (!this.characterId) return { ok: false, why: '还没选角色' };
      const left = this.remaining();
      if (left < 0) return { ok: false, why: '点数超了 ' + (-left) + ' 点' };
      return { ok: true };
    },

    /* ── 选择 ─────────────────────────────────────── */
    reset() {
      this.unapply();
      this.characterId = null; this.picked = [];
      return this;
    },
    selectCharacter(id) {
      if (!C.Config.characters.some(c => c.id === id)) return { ok: false, why: '没有这个角色' };
      if (this.characterId === id) return { ok: true };
      this.characterId = id;
      /* 换角色要清空已选：新角色的固定特性可能和已选的冲突，
         而且起始点数也变了。**留着一份非法的配置比清空更糟。** */
      this.picked = [];
      return { ok: true };
    },

    /* ── 生效 ───────────────────────────────────────
       把所有 modifiers 一次性注册进管线。之后本模块不再参与任何逻辑。 */
    apply() {
      if (this.applied) this.unapply();
      const all = this.fixedTraits().concat(this.picked.map(id => Object.assign({ id }, this.trait(id))));
      for (const t of all) {
        if (!t.keys) continue;
        for (let i = 0; i < t.keys.length; i++) {
          const [key, mode, amount] = t.keys[i];
          const mid = MOD_PREFIX + t.id + ':' + i;
          if (mode === 'add') C.Mod.add(key, mid, amount);
          else if (mode === 'set') C.Mod.override(key, mid, amount);
          else C.Mod.mul(key, mid, amount);
          this._regs.push([key, mid]);
        }
      }
      // 「N 级起步」类：**只给等级，不给经验**（规格 1.5）
      for (const t of all) {
        if (!t.skill) continue;
        const [name, lv] = t.skill;
        if (name === 'cooking' && C.Cooking) C.Cooking.baseLevel = Math.max(C.Cooking.baseLevel || 0, lv);
        else if (C.Config.skills[name]) C.Config.skills[name].level = Math.max(C.Config.skills[name].level, lv);
      }
      this.applied = true;
      C.EventBus.publish('LoadoutAppliedEvent', { characterId: this.characterId, picked: this.picked.slice() });
      return this;
    },
    unapply() {
      for (const [key, id] of this._regs) C.ModifierPipeline.unregister(key, id);
      this._regs = [];
      if (C.Cooking) C.Cooking.baseLevel = 0;
      for (const k of Object.keys(C.Config.skills)) C.Config.skills[k].level = 0;
      this.applied = false;
      return this;
    },

    /** 某个标记开着没有（`specialFlags`，规格 4.3）。管线表达不了的效果查这里。 */
    hasFlag(flag) {
      const all = this.fixedTraits().concat(this.picked.map(id => Object.assign({ id }, this.trait(id))));
      return all.some(t => t.flags && t.flags.indexOf(flag) >= 0);
    },
    /** `MAP_REVEAL_60` → 60。没有就 0。 */
    flagNumber(prefix) {
      const all = this.fixedTraits().concat(this.picked.map(id => Object.assign({ id }, this.trait(id))));
      for (const t of all) {
        for (const f of (t.flags || [])) {
          if (f.indexOf(prefix) === 0) { const n = parseFloat(f.slice(prefix.length)); if (!isNaN(n)) return n; }
        }
      }
      return 0;
    },

    /** 开局物品（角色自带）。返回 item id 数组。 */
    startingItems() { const ch = this.character(); return ch ? ch.items.slice() : []; },
    /** 出生点 [楼 id, 楼层, 房间序号] */
    spawn() { const ch = this.character(); return ch ? ch.spawn.slice() : null; },
    /** 这个角色支不支持新手教学（规格 5.2 风险四：只有学生支持） */
    tutorialSupported() { const ch = this.character(); return !!(ch && ch.tutorial); },

    serialize() { return { characterId: this.characterId, picked: this.picked.slice() }; },
    deserialize(d) {
      if (!d) return this;
      this.unapply();
      this.characterId = d.characterId || null;
      this.picked = (d.picked || []).filter(id => C.Config.traits[id]);
      return this;
    }
  };

  C.Loadout = Loadout;
})(typeof globalThis !== 'undefined' ? globalThis : this);
