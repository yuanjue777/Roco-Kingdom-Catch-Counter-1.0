/*
 * 02-modifiers.js —— 数值修正管线（主文档 11.3）
 * 所有可变数值的唯一出口。执行顺序：全部 Additive → 全部 Multiplicative → Override。
 * 硬约束：业务逻辑不读熟练度/负重/buff，只向本管线要最终值。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  const Mode = { Additive: 'Additive', Multiplicative: 'Multiplicative', Override: 'Override' };
  const registry = new Map();   // key -> Modifier[]

  function sortByPriority(list) { list.sort((a, b) => a.priority - b.priority); }

  C.ModifierMode = Mode;

  C.ModifierPipeline = {
    /**
     * @param {string} key      形如 'sound.footstep'、'hearing.threshold'
     * @param {object} modifier { id, priority, mode, ownerId?, apply(current, ownerId) }
     *                          ownerId 省略或 -1 表示全局修正。
     */
    register(key, modifier) {
      if (!registry.has(key)) registry.set(key, []);
      const list = registry.get(key);
      if (!list.some(m => m.id === modifier.id)) {
        list.push(Object.assign({ priority: 0, mode: Mode.Multiplicative, ownerId: -1 }, modifier));
        sortByPriority(list);
      }
      return modifier;
    },
    unregister(key, modifierOrId) {
      const list = registry.get(key);
      if (!list) return;
      const id = (typeof modifierOrId === 'string') ? modifierOrId : modifierOrId.id;
      const i = list.findIndex(m => m.id === id);
      if (i >= 0) list.splice(i, 1);
    },
    has(key, id) {
      const list = registry.get(key);
      return !!(list && list.some(m => m.id === id));
    },
    query(key, baseValue, ownerId) {
      const list = registry.get(key);
      if (!list || list.length === 0) return baseValue;
      let v = baseValue;
      // 1) Additive
      for (const m of list) {
        if (m.mode !== Mode.Additive) continue;
        if (m.ownerId !== -1 && m.ownerId !== ownerId) continue;
        v = m.apply(v, ownerId);
      }
      // 2) Multiplicative
      for (const m of list) {
        if (m.mode !== Mode.Multiplicative) continue;
        if (m.ownerId !== -1 && m.ownerId !== ownerId) continue;
        v = m.apply(v, ownerId);
      }
      // 3) Override（若有多个，优先级最高的最后生效）
      for (const m of list) {
        if (m.mode !== Mode.Override) continue;
        if (m.ownerId !== -1 && m.ownerId !== ownerId) continue;
        v = m.apply(v, ownerId);
      }
      return v;
    },
    // 调试用：列出某个 key 上挂了哪些修正来源
    inspect(key) {
      return (registry.get(key) || []).map(m => ({ id: m.id, mode: m.mode, priority: m.priority, ownerId: m.ownerId }));
    },
    clear() { registry.clear(); }
  };

  // 常用简写
  C.Mod = {
    mul(key, id, factorFn, ownerId, priority) {
      return C.ModifierPipeline.register(key, {
        id, priority: priority || 0, mode: Mode.Multiplicative, ownerId: ownerId === undefined ? -1 : ownerId,
        apply: (v) => v * (typeof factorFn === 'function' ? factorFn() : factorFn)
      });
    },
    add(key, id, deltaFn, ownerId, priority) {
      return C.ModifierPipeline.register(key, {
        id, priority: priority || 0, mode: Mode.Additive, ownerId: ownerId === undefined ? -1 : ownerId,
        apply: (v) => v + (typeof deltaFn === 'function' ? deltaFn() : deltaFn)
      });
    },
    override(key, id, valueFn, ownerId, priority) {
      return C.ModifierPipeline.register(key, {
        id, priority: priority || 0, mode: Mode.Override, ownerId: ownerId === undefined ? -1 : ownerId,
        apply: () => (typeof valueFn === 'function' ? valueFn() : valueFn)
      });
    },
    remove(key, id) { C.ModifierPipeline.unregister(key, id); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
