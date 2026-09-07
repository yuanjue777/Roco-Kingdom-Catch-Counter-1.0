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
    // carry: 这是个背包类容器 —— 可以按住整个拎走，值是拎走之后变成哪件背包物品
    bag:      { name: '书包',     grid: [5, 4], search: 3, color: 0x4c6b8a, size: [0.45, 0.5, 0.3],
                carry: 'schoolBag' },
    trash:    { name: '垃圾桶',   grid: [2, 2], search: 2, color: 0x5a6a5a, size: [0.45, 0.6, 0.45] },
    locker:   { name: '储物柜',   grid: [3, 4], search: 4, color: 0x74808c, size: [0.6, 1.7, 0.5] },

    /* ── M2：全校其余地点的容器 ───────────────────────
       格子越大、翻得越久 —— 「你在翻箱子的时候是聋的也是瞎的，而箱子越大翻得越久」。
       食堂的米面柜 5×5 翻 7 秒，是全校最危险的一次搜刮，而它恰恰在丧尸最密的楼里。 */
    podium:     { name: '讲台',     grid: [3, 3], search: 3, color: 0x8d7a5c, size: [1.2, 0.9, 0.6] },
    classDesk:  { name: '课桌',     grid: [2, 3], search: 2, color: 0x9a8a6a, size: [0.6, 0.5, 0.45] },
    reagentCab: { name: '试剂柜',   grid: [4, 4], search: 5, color: 0x5f8a7a, size: [0.7, 1.8, 0.5] },
    bookshelf:  { name: '书架',     grid: [5, 5], search: 6, color: 0x7a6a52, size: [0.5, 1.9, 1.6] },
    pantry:     { name: '米面柜',   grid: [5, 5], search: 7, color: 0x8a7a5a, size: [1.2, 1.9, 0.7] },
    counter:    { name: '灶台',     grid: [4, 4], search: 5, color: 0x6f7a80, size: [1.6, 0.9, 0.7] },
    fridge:     { name: '冰柜',     grid: [4, 4], search: 5, color: 0x93a2ab, size: [0.9, 1.7, 0.7] },
    medCab:     { name: '药柜',     grid: [3, 4], search: 5, color: 0xa8b4ae, size: [0.7, 1.7, 0.4] },
    shopShelf:  { name: '货架',     grid: [4, 4], search: 3, color: 0x87796a, size: [1.4, 1.7, 0.5] },
    gearRack:   { name: '器材架',   grid: [5, 4], search: 4, color: 0x6c7f6a, size: [1.6, 1.8, 0.6] },
    toolCab:    { name: '工具柜',   grid: [4, 4], search: 5, color: 0x76706a, size: [0.8, 1.7, 0.5] },
    fileCab:    { name: '档案柜',   grid: [4, 4], search: 4, color: 0x7d8288, size: [0.8, 1.7, 0.45] },
    // 保安柜做成 5 格宽：钢叉是 1×5，柜子窄一格就永远塞不进去
    guardLocker:{ name: '保安柜',   grid: [5, 4], search: 5, color: 0x5f6b78, size: [0.8, 1.8, 0.5] }
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
                                     ['alcohol', 1, 1, 1], ['cloth', 2, 1, 2], ['dirtyWater', 2, 1, 1]] },

    /* ── M2 产出池 ────────────────────────────────────
       瓶装水的权重全校都压得很低：它是第二幕唯一能顶用的东西，多一瓶少一瓶
       都会动到第 8 天停水之后的生死线（10.3）。剩下的按「这地方现实里有什么」写。 */
    podium:     { count: [1, 2], pool: [['stationery', 4, 1, 1], ['textbook', 4, 1, 1], ['clockPart', 2, 1, 2],
                                        ['key', 1, 1, 1], ['chocolate', 2, 1, 1]] },
    classDesk:  { count: [1, 2], pool: [['stationery', 4, 1, 1], ['textbook', 4, 1, 1], ['biscuit', 2, 1, 1],
                                        ['novel', 2, 1, 1], ['battery', 2, 1, 1], ['cloth', 1, 1, 1]] },
    reagentCab: { count: [2, 3], pool: [['alcohol', 4, 1, 1], ['reagent', 3, 1, 1], ['beaker', 3, 1, 1],
                                        ['burner', 2, 1, 1], ['glassBottle', 2, 1, 1], ['lighter', 1, 1, 1]] },
    bookshelf:  { count: [2, 3], pool: [['novel', 5, 1, 2], ['textbook', 4, 1, 1], ['manual', 1, 1, 1],
                                        ['stationery', 2, 1, 1]] },
    pantry:     { count: [2, 3], pool: [['rice', 4, 1, 1], ['flour', 3, 1, 1], ['oil', 2, 1, 1],
                                        ['salt', 2, 1, 1], ['noodle', 3, 1, 2]] },
    counter:    { count: [1, 3], pool: [['pot', 3, 1, 1], ['gasCan', 2, 1, 1], ['lighter', 2, 1, 1],
                                        ['salt', 2, 1, 1], ['oil', 2, 1, 1], ['cloth', 2, 1, 2]] },
    fridge:     { count: [1, 3], pool: [['sausage', 4, 1, 2], ['canned', 3, 1, 1], ['soda', 3, 1, 2],
                                        ['water', 2, 1, 1], ['bigWater', 1, 1, 1]] },
    medCab:     { count: [2, 3], pool: [['bandage', 5, 1, 2], ['alcohol', 3, 1, 1], ['painkiller', 3, 1, 1],
                                        ['splint', 2, 1, 1], ['cloth', 2, 1, 2]] },
    shopShelf:  { count: [2, 4], pool: [['biscuit', 4, 1, 2], ['chocolate', 4, 1, 2], ['soda', 3, 1, 2],
                                        ['noodle', 3, 1, 1], ['lighter', 2, 1, 1], ['battery', 3, 1, 2],
                                        ['sausage', 2, 1, 2], ['water', 1, 1, 1]] },
    gearRack:   { count: [1, 3], pool: [['bat', 3, 1, 1], ['rope', 3, 1, 1], ['cloth', 2, 1, 2],
                                        ['stone', 2, 2, 4], ['mop', 1, 1, 1]] },
    toolCab:    { count: [1, 3], pool: [['wrench', 3, 1, 1], ['toolkit', 2, 1, 1], ['fuse', 3, 1, 2],
                                        ['bikePart', 2, 1, 1], ['cloth', 2, 1, 1], ['tarp', 1, 1, 1]] },
    fileCab:    { count: [1, 3], pool: [['key', 3, 1, 1], ['textbook', 3, 1, 1], ['stationery', 2, 1, 1],
                                        ['battery', 2, 1, 1], ['radio', 1, 1, 1]] },
    guardLocker:{ count: [1, 3], pool: [['baton', 3, 1, 1], ['flashlight', 3, 1, 1], ['radio', 2, 1, 1],
                                        ['key', 2, 1, 1], ['pitchfork', 1, 1, 1]] }
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
      id: nextId++, kind, name: k.name, roomName, carry: k.carry || null,
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

  /* ── M2：全校布置 ──────────────────────────────────
     房型 → 这类房间里摆哪些容器，以及各自在房间里的相对位置 [x 比例, z 比例]。
     位置只影响「走到哪按 F」，不参与碰撞，所以可以贴着家具摆。 */
  const ROOM_CONTAINERS = {
    dorm:      [['desk', 0.5, 0.86], ['wardrobe', 0.88, 0.20], ['underBed', 0.12, 0.42]],
    classroom: [['podium', 0.5, 0.88], ['classDesk', 0.25, 0.45], ['classDesk', 0.75, 0.45]],
    lab:       [['reagentCab', 0.85, 0.85], ['desk', 0.2, 0.5]],
    library:   [['bookshelf', 0.3, 0.6], ['bookshelf', 0.75, 0.6]],
    canteen:   [['pantry', 0.15, 0.85], ['counter', 0.5, 0.88], ['fridge', 0.85, 0.85]],
    clinic:    [['medCab', 0.85, 0.8], ['desk', 0.3, 0.85]],
    office:    [['fileCab', 0.15, 0.55], ['desk', 0.6, 0.82]],
    guard:     [['guardLocker', 0.85, 0.4], ['desk', 0.35, 0.85]],
    shop:      [['shopShelf', 0.25, 0.6], ['shopShelf', 0.7, 0.6], ['trash', 0.9, 0.15]],
    gym:       [['gearRack', 0.2, 0.8], ['locker', 0.8, 0.8]],
    boiler:    [['toolCab', 0.2, 0.4], ['toolCab', 0.8, 0.4]]
  };
  // 每层走廊统一：储物柜 ×2 + 垃圾桶 ×1（沿走廊长度的比例位置）
  const CORRIDOR_CONTAINERS = [['locker', 0.2], ['locker', 0.68], ['trash', 0.44]];

  /* 稀有物资的固定位置。**这张表是玩家跨局知识的全部意义所在** ——
     「抗生素在医务室 102 的药柜里」这句话之所以值钱，就是因为它每一局都成立。
     全校仅 4 支抗生素（10.2），一支放在宿舍楼当教学，三支在该在的地方。 */
  /* ── 教学关卡的保底布置（教学设计 3.0 / 3.1）──────────
     **402 柜子里的电水壶是全游戏唯一一件「保底物品」**：
     它保证玩家从第一分钟起就能烧水净化，不会因为运气问题陷入死局。 */
  const CAMPUS_FIXED = [
    { room: '男402', kind: 'wardrobe',    items: ['kettle', 'water', 'biscuit', 'shortWire'] },
    { room: '男403', kind: 'wardrobe',    items: ['schoolBag', 'noodle', 'noodle'] },   // 目标②的答案
    { room: '男404', kind: 'desk',        items: ['water', 'water', 'biscuit', 'powerStrip'] },
    { room: '男406', kind: 'desk',        items: ['glassBox', 'shortWire', 'note406'] },
    { room: '男301', kind: 'desk',        items: ['deskLamp'] },
    { room: '男303', kind: 'wardrobe',    items: ['riceCooker', 'riceBag', 'riceBag'] },
    { room: '男304', kind: 'underBed',    items: ['tarp', 'rope', 'toolkit'] },
    { room: '男306', kind: 'desk',        items: ['battery', 'battery', 'flashlight'] },
    { room: '男201', kind: 'desk',        items: ['stone', 'stone', 'stone'] },          // 投石的弹药
    { room: '男203', kind: 'underBed',    items: ['canned', 'bandage', 'bandage'] },
    { room: '男206', kind: 'desk',        items: ['skillet', 'note206'] },
    { room: '医102', kind: 'medCab',      items: ['antibiotic', 'antibiotic'] },
    { room: '实203', kind: 'reagentCab',  items: ['antibiotic'] },
    { room: '男401', kind: 'wardrobe',    items: ['antibiotic'] },
    { room: '保102', kind: 'guardLocker', items: ['tacticalBag', 'campusMap', 'masterKey'] },
    { room: '保103', kind: 'guardLocker', items: ['pitchfork', 'radio'] },
    { room: '体102', kind: 'gearRack',    items: ['hikingBag', 'starterGun', 'rope'] },
    // 发电机 4×4 = 16 格，一个工具柜就被它占满 —— 柴油只能另放一个柜子
    { room: '锅101', kind: 'toolCab',     items: ['generator'] },
    { room: '锅102', kind: 'toolCab',     items: ['diesel', 'fuse'] },
    { room: '行401', kind: 'fileCab',     items: ['beacon', 'broadcastPart'] },
    { room: '行402', kind: 'fileCab',     items: ['broadcastPart', 'masterKey'] },
    { room: '图301', kind: 'bookshelf',   items: ['manual'] },
    { room: '食201', kind: 'pantry',      items: ['rice'] },
    { room: '食202', kind: 'pantry',      items: ['rice', 'oil'] }
  ];

  /**
   * 全校物资布置（M2）。**同一张地图每次生成结果完全相同**（固定种子）——
   * 玩家第二次开局时，医务室的药柜里仍然是那两支抗生素。
   */
  function placeInCampus(level, seed) {
    nextId = 1;
    const rng = new C.Rng(seed === undefined ? 20260905 : seed);
    const out = [];

    for (const b of level.buildings) {
      const recipe = ROOM_CONTAINERS[b.spec.roomType] || ROOM_CONTAINERS.dorm;
      for (const meta of b.floorsMeta) {
        const y = meta.y0;
        for (const room of meta.rooms) {
          const bb = room.bounds;
          const fx = (t) => bb.min.x + (bb.max.x - bb.min.x) * t;
          const fz = (t) => bb.min.z + (bb.max.z - bb.min.z) * t;
          /* 一个房间里可能摆着两个同型容器（锅炉房两个工具柜、教室两张课桌）。
             固定放置必须只兑现一次，否则「全校仅 4 支抗生素」会变成 8 支。 */
          const fixedHere = CAMPUS_FIXED.filter(f => f.room === room.name);
          const usedFixed = new Set();
          for (const [kind, tx, tz] of recipe) {
            const entry = fixedHere.find(f => f.kind === kind && !usedFixed.has(f));
            if (entry) usedFixed.add(entry);
            const fixed = entry ? entry.items : undefined;
            const c = makeContainer(kind, C.V.make(fx(tx), y + KINDS[kind].size[1] / 2, fz(tz)),
                                    rng, fixed, room.name);
            c.bid = b.buildingId;
            out.push(c);
          }
          // 宿舍才有「约四成房间地上扔着一个书包」这条（10.1d）
          if (b.spec.roomType === 'dorm' && rng.next() < 0.42) {
            const c = makeContainer('bag', C.V.make(fx(0.62), y + 0.25, fz(0.55)), rng, null, room.name);
            c.bid = b.buildingId;
            out.push(c);
          }
        }
        const cb = meta.corridor.bounds;
        for (const [kind, t] of CORRIDOR_CONTAINERS) {
          const c = makeContainer(kind,
            C.V.make(cb.min.x + (cb.max.x - cb.min.x) * t, y + KINDS[kind].size[1] / 2, cb.min.z + 0.55),
            rng, null, meta.corridor.name);
          c.bid = b.buildingId;
          out.push(c);
        }
      }
    }

    level.containers = out;
    return out;
  }

  /** 校园里散落在地上的东西：走廊的石头 + 室外分区的石头 */
  function placeLooseInCampus(level, seed) {
    const rng = new C.Rng(seed === undefined ? 7712 : seed);
    const loose = [];
    for (const b of level.buildings) {
      for (const meta of b.floorsMeta) {
        const cb = meta.corridor.bounds;
        for (let i = 0; i < 2; i++) {
          const x = cb.min.x + rng.range(1.5, (cb.max.x - cb.min.x) - 1.5);
          loose.push({ id: 'loose' + loose.length, item: C.makeItem('stone', rng.int(2, 4)),
                       pos: C.V.make(x, meta.y0 + 0.12, cb.min.z + rng.range(0.5, 1.8)),
                       bid: b.buildingId, taken: false });
        }
      }
    }
    // 室外：投石是潜行的核心工具，路上必须捡得到
    for (const z of level.zones) {
      for (let i = 0; i < 4; i++) {
        let x = 0, zz = 0;
        for (let t = 0; t < 20; t++) {
          x = rng.range(z.x0 + 4, z.x1 - 4); zz = rng.range(z.z0 + 4, z.z1 - 4);
          if (!level.buildings.some(b => x > b.footprint.x0 - 2 && x < b.footprint.x1 + 2 &&
                                         zz > b.footprint.z0 - 2 && zz < b.footprint.z1 + 2)) break;
        }
        loose.push({ id: 'loose' + loose.length, item: C.makeItem('stone', rng.int(3, 6)),
                     pos: C.V.make(x, 0.12, zz), taken: false });
      }
    }
    level.looseItems = loose;
    return loose;
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
  C.ContainerPools = POOLS;
  C.CampusFixedLoot = CAMPUS_FIXED;
  C.placeContainers = placeInDormitory;
  C.placeLooseItems = placeLooseItems;
  C.placeCampusContainers = placeInCampus;
  C.placeCampusLooseItems = placeLooseInCampus;
})(typeof globalThis !== 'undefined' ? globalThis : this);
