/*
 * 22-loot.js —— 容器与物资布置（主文档 10.2）
 *
 * 硬规则：**完全手工放置，不做随机生成，不刷新。**
 * 玩家的地图知识是跨局的核心资产，随机化会摧毁它。
 *
 * 这里的做法是「按房间类型定义产出池 + 固定种子生成一次」：
 * 结果对同一张地图**永远相同**，等价于把布置落盘成固定数据，
 * 但省掉了手工填几百个容器的重复劳动（v1 第 13.2 节风险四的缓解方案）。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  /* 容器原型。searchSeconds 是「快速翻找」的总时长，慢速翻找 ×2.25（4s → 9s）。 */
  const KINDS = {
    desk:     { name: '书桌抽屉', grid: [3, 3], search: 4, color: 0x9a7f5f, size: [0.7, 0.5, 0.5] },
    wardrobe: { name: '衣柜',     grid: [4, 4], search: 5, color: 0x8a6f52, size: [0.8, 1.8, 0.6] },
    underBed: { name: '床下箱',   grid: [4, 3], search: 4, color: 0x6f5d4a, size: [0.9, 0.4, 0.6] },
    bag:      { name: '书包',     grid: [5, 4], search: 3, color: 0x4c6b8a, size: [0.45, 0.5, 0.3] },
    trash:    { name: '垃圾桶',   grid: [2, 2], search: 2, color: 0x5a6a5a, size: [0.45, 0.6, 0.45] },
    locker:   { name: '储物柜',   grid: [3, 4], search: 4, color: 0x74808c, size: [0.6, 1.7, 0.5] }
  };

  /* 产出池：[物品id, 权重, 最少, 最多]。抽 count 次，每次按权重挑一样。 */
  const POOLS = {
    desk:     { count: [1, 3], pool: [['clockPart', 3, 1, 2], ['battery', 3, 1, 2], ['lighter', 2, 1, 1],
                                     ['textbook', 3, 1, 1], ['cloth', 2, 1, 2], ['key', 1, 1, 1], ['chocolate', 2, 1, 1]] },
    wardrobe: { count: [1, 3], pool: [['cloth', 5, 1, 3], ['smallBag', 2, 1, 1], ['schoolBag', 1, 1, 1],
                                     ['flashlight', 2, 1, 1], ['bandage', 2, 1, 1]] },
    underBed: { count: [1, 3], pool: [['glassBottle', 3, 1, 1], ['mop', 1, 1, 1], ['textbook', 3, 1, 1],
                                     ['stone', 3, 2, 4], ['tarp', 1, 1, 1], ['biscuit', 3, 1, 2]] },
    bag:      { count: [2, 4], pool: [['water', 4, 1, 1], ['biscuit', 4, 1, 2], ['noodle', 3, 1, 1],
                                     ['sausage', 3, 1, 2], ['textbook', 2, 1, 1], ['battery', 2, 1, 1]] },
    trash:    { count: [1, 2], pool: [['emptyBottle', 5, 1, 1], ['cloth', 3, 1, 1], ['glassBottle', 2, 1, 1]] },
    locker:   { count: [1, 3], pool: [['canned', 3, 1, 1], ['water', 3, 1, 1], ['bandage', 2, 1, 1],
                                     ['alcohol', 1, 1, 1], ['cloth', 2, 1, 2], ['dirtyWater', 2, 1, 1]] }
  };

  /* 固定放置：不走随机池，写死在具体位置。稀有物资必须这样放，
     否则玩家「知道医务室有抗生素」这条知识就没有意义了。 */
  const FIXED = [
    { room: '401', kind: 'wardrobe', items: ['antibiotic'] },
    { room: '305', kind: 'underBed', items: ['tacticalBag'] },
    { room: '203', kind: 'desk',     items: ['antibiotic'] }
  ];

  function pick(rng, pool) {
    let total = 0;
    for (const e of pool) total += e[1];
    let r = rng.next() * total;
    for (const e of pool) { r -= e[1]; if (r <= 0) return e; }
    return pool[pool.length - 1];
  }

  function fill(grid, kind, rng, fixedItems) {
    for (const id of fixedItems || []) grid.autoAdd(C.makeItem(id));
    const spec = POOLS[kind];
    if (!spec) return;
    const n = rng.int(spec.count[0], spec.count[1]);
    for (let i = 0; i < n; i++) {
      const e = pick(rng, spec.pool);
      grid.autoAdd(C.makeItem(e[0], rng.int(e[2], e[3])));
    }
  }

  let nextId = 1;
  function makeContainer(kind, pos, rng, fixedItems, roomName) {
    const k = KINDS[kind];
    const g = new C.Grid(k.grid[0], k.grid[1], k.name);
    fill(g, kind, rng, fixedItems);
    return {
      id: nextId++, kind, name: k.name, roomName,
      pos, size: k.size, color: k.color,
      grid: g, searchSeconds: k.search,
      revealed: 0,          // 已点亮的物品数（三角洲式逐个点亮）
      opened: false
    };
  }

  /**
   * 在宿舍楼里布置容器。同一张地图**每次生成结果完全相同**（固定种子）。
   * @returns 容器数组，同时挂到 level.containers
   */
  function placeInDormitory(level, seed) {
    nextId = 1;
    const rng = new C.Rng(seed === undefined ? 20260904 : seed);
    const out = [];
    const L = C.Config.level;

    for (const meta of level.floorsMeta) {
      const y = meta.y0;
      for (const room of meta.rooms) {
        const b = room.bounds;
        const fx = (t) => b.min.x + (b.max.x - b.min.x) * t;
        const fz = (t) => b.min.z + (b.max.z - b.min.z) * t;
        const fixedHere = FIXED.filter(f => f.room === room.name);
        const fixedOf = (kind) => (fixedHere.find(f => f.kind === kind) || {}).items;

        out.push(makeContainer('desk',     C.V.make(fx(0.5), y + 0.78, fz(0.86)), rng, fixedOf('desk'), room.name));
        out.push(makeContainer('wardrobe', C.V.make(fx(0.88), y + 0.9,  fz(0.20)), rng, fixedOf('wardrobe'), room.name));
        out.push(makeContainer('underBed', C.V.make(fx(0.12), y + 0.2,  fz(0.42)), rng, fixedOf('underBed'), room.name));
        // 约四成房间地上还扔着一个书包
        if (rng.next() < 0.42) out.push(makeContainer('bag', C.V.make(fx(0.62), y + 0.25, fz(0.55)), rng, null, room.name));
      }
      // 走廊：两个储物柜 + 一个垃圾桶
      const cb = meta.corridor.bounds;
      const cz = cb.min.z + 0.45;
      out.push(makeContainer('locker', C.V.make(cb.min.x + 6, y + 0.85, cz), rng, null, meta.corridor.name));
      out.push(makeContainer('locker', C.V.make(cb.min.x + 20, y + 0.85, cz), rng, null, meta.corridor.name));
      out.push(makeContainer('trash',  C.V.make(cb.min.x + 13, y + 0.3, cz), rng, null, meta.corridor.name));
    }

    level.containers = out;
    return out;
  }

  /** 玩家脚边散落的物品（走廊里的石头之类），直接捡不用翻找 */
  function placeLooseItems(level, seed) {
    const rng = new C.Rng(seed === undefined ? 771 : seed);
    const loose = [];
    for (const meta of level.floorsMeta) {
      const cb = meta.corridor.bounds;
      for (let i = 0; i < 3; i++) {
        const x = cb.min.x + rng.range(2, (cb.max.x - cb.min.x) - 2);
        loose.push({ id: 'loose' + loose.length, item: C.makeItem('stone', rng.int(2, 4)),
                     pos: C.V.make(x, meta.y0 + 0.12, cb.min.z + rng.range(0.5, 2.0)), taken: false });
      }
    }
    level.looseItems = loose;
    return loose;
  }

  C.ContainerKinds = KINDS;
  C.placeContainers = placeInDormitory;
  C.placeLooseItems = placeLooseItems;
})(typeof globalThis !== 'undefined' ? globalThis : this);
