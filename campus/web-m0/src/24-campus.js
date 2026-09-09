/*
 * 24-campus.js —— 全校灰盒地图（主文档 13.1 / 13.3 / 13.4，M2）
 *
 * 十三栋楼 + 八个室外分区 + 一圈围墙。**几何和声图仍然由同一段代码推导** ——
 * 每栋楼都调 08-level.js 的板楼模板，这里只负责摆位置、放家具、连室外。
 *
 * 布局表在 00-config.js 的 campus 段。这个文件里不应该出现任何坐标常量，
 * 出现了就说明它该搬回配置里去。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const { AABB, V, PortalType, PortalState } = C;

  /* ── 各类房间的家具 ────────────────────────────────
     家具在这里只有两个作用：挡视线（掩体）和挡路（绕行）。
     统一留出门前 1.2m 的空地，否则丧尸会卡在门口的桌子上。 */
  const FURNITURE = {
    dorm: C.dormFurniture,

    classroom(out, x0, x1, y, z0, z1) {
      const rows = 3, cols = 2;
      const w = (x1 - x0 - 0.8) / cols - 0.4;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const bx = x0 + 0.4 + c * (w + 0.4), bz = z0 + 1.4 + r * 1.15;
        if (bz + 0.6 > z1 - 0.2) continue;
        out.push({ tag: 'desk', box: AABB.make(bx, y, bz, bx + w, y + 0.75, bz + 0.6) });
      }
    },

    lab(out, x0, x1, y, z0, z1) {
      for (let r = 0; r < 2; r++) {
        const bz = z0 + 1.6 + r * 1.8;
        if (bz + 0.8 > z1 - 0.3) continue;
        out.push({ tag: 'desk', box: AABB.make(x0 + 0.4, y, bz, x1 - 0.4, y + 0.85, bz + 0.8) });
      }
    },

    /* 书架高 1.9m，是全校最好的掩体 —— 图书馆之所以是理想据点，
       一半原因是安静，另一半原因是这些架子。 */
    library(out, x0, x1, y, z0, z1) {
      for (let c = 0; c < 3; c++) {
        const bx = x0 + 0.5 + c * 1.2;
        if (bx + 0.5 > x1 - 0.4) break;
        out.push({ tag: 'shelf', box: AABB.make(bx, y, z0 + 1.3, bx + 0.5, y + 1.9, z1 - 0.4) });
      }
    },

    canteen(out, x0, x1, y, z0, z1) {
      for (let r = 0; r < 3; r++) {
        const bz = z0 + 1.6 + r * 2.4;
        if (bz + 0.9 > z1 - 0.4) continue;
        out.push({ tag: 'desk', box: AABB.make(x0 + 0.6, y, bz, x1 - 0.6, y + 0.75, bz + 0.9) });
      }
    },

    gym(out, x0, x1, y, z0, z1) {
      for (let c = 0; c < 4; c++) {
        const bx = x0 + 1.0 + c * 2.4;
        if (bx + 1.2 > x1 - 1.0) break;
        out.push({ tag: 'crate', box: AABB.make(bx, y, z0 + 2.0, bx + 1.2, y + 1.0, z0 + 3.2) });
      }
    },

    clinic(out, x0, x1, y, z0, z1) {
      out.push({ tag: 'bed', box: AABB.make(x0 + 0.3, y, z0 + 1.4, x0 + 1.3, y + 0.55, z0 + 3.4) });
      out.push({ tag: 'shelf', box: AABB.make(x1 - 0.9, y, z1 - 1.4, x1 - 0.2, y + 1.8, z1 - 0.3) });
    },

    office(out, x0, x1, y, z0, z1) {
      out.push({ tag: 'desk', box: AABB.make(x0 + 0.8, y, z1 - 1.6, x1 - 0.8, y + 0.75, z1 - 0.6) });
      out.push({ tag: 'shelf', box: AABB.make(x0 + 0.2, y, z0 + 1.4, x0 + 0.9, y + 1.8, z0 + 3.2) });
    },

    guard(out, x0, x1, y, z0, z1) {
      out.push({ tag: 'desk', box: AABB.make(x0 + 0.5, y, z1 - 1.4, x1 - 0.5, y + 0.75, z1 - 0.5) });
      out.push({ tag: 'shelf', box: AABB.make(x1 - 0.8, y, z0 + 1.4, x1 - 0.2, y + 1.8, z0 + 2.8) });
    },

    shop(out, x0, x1, y, z0, z1) {
      for (let c = 0; c < 2; c++) {
        const bx = x0 + 0.5 + c * 1.6;
        if (bx + 0.6 > x1 - 0.4) break;
        out.push({ tag: 'shelf', box: AABB.make(bx, y, z0 + 1.3, bx + 0.6, y + 1.7, z1 - 0.4) });
      }
    },

    boiler(out, x0, x1, y, z0, z1) {
      out.push({ tag: 'crate', box: AABB.make(x0 + 0.4, y, z0 + 1.6, x1 - 0.4, y + 1.6, z1 - 0.6) });
    }
  };

  /** 围墙：一圈实心墙，在出入口处按 exits 表开口 */
  function buildPerimeter(solids, cfg) {
    const w = cfg.wall, T = w.thickness, H = w.height;
    const byS = (side) => cfg.exits.filter(e => e.side === side).map(e => ({ a0: e.a0, a1: e.a1, y0: 0, y1: H }));
    C.wallWithHoles(solids, 'wall', 'x', w.z0 - T, w.z0, w.x0, w.x1, 0, H, byS('south'));
    C.wallWithHoles(solids, 'wall', 'x', w.z1, w.z1 + T, w.x0, w.x1, 0, H, byS('north'));
    C.wallWithHoles(solids, 'wall', 'z', w.x0 - T, w.x0, w.z0, w.z1, 0, H, byS('west'));
    C.wallWithHoles(solids, 'wall', 'z', w.x1, w.x1 + T, w.z0, w.z1, 0, H, byS('east'));
  }

  /** 车棚与操场看台：露天构筑物，不建节点，声学上属于所在分区 */
  function buildOutdoorStructures(solids, cfg) {
    const c = cfg.carport;
    solids.push({ tag: 'roof', box: AABB.make(c.x0, c.height, c.z0, c.x1, c.height + 0.2, c.z1) });
    for (const px of [c.x0 + 0.3, c.x1 - 0.6]) for (const pz of [c.z0 + 0.3, c.z1 - 0.6]) {
      solids.push({ tag: 'wall', box: AABB.make(px, 0, pz, px + 0.3, c.height, pz + 0.3) });
    }
    const b = cfg.bleachers;
    for (let s = 0; s < 3; s++) {
      const d = (b.z1 - b.z0) / 3;
      solids.push({ tag: 'stair',
        box: AABB.make(b.x0, 0, b.z0 + s * d, b.x1, (s + 1) * b.height / 3, b.z0 + (s + 1) * d) });
    }
  }

  /** 某点是否落在任何一栋楼的占地里（留 margin 的余量） */
  function insideAnyBuilding(built, x, z, margin) {
    for (const b of built) {
      const f = b.footprint;
      if (x > f.x0 - margin && x < f.x1 + margin && z > f.z0 - margin && z < f.z1 + margin) return true;
    }
    return false;
  }

  /* ── 丧尸布置 ──────────────────────────────────────
     总数 320，不刷新（7.1）。配比游荡者 85% / 蜷伏者 10% / 奔行者 5%。
     奔行者第 12 天才出现，所以先按游荡者放，到点由 ZombieManager 顶替（7.2）。 */
  function placeZombies(built, cfg, rng, tutorialDorm) {
    const spawns = [];

    /* ── 出生的宿舍楼走教学关卡的危险分层（教学设计 0.2）──
       **宿舍楼不能一只丧尸都没有**，但也不能按 26 只的密度放。
       四楼三楼 0 只（绝对安全，学移动/搜刮/电力）；
       二楼 1 只**锁死在 205 里，永远出不来**（零风险的声音教室）；
       一楼 1 只在走廊巡逻（第一次真正的考试）。
       省下来的名额挪到室外，全校总数仍然是 320。 */
    let surplus = 0;
    for (const b of built) {
      /* **只有走教学的那一局才给宿舍楼铺这套分层。**
         选了体育队长却让宿舍楼只剩 2 只，等于凭空送出一栋空楼。 */
      if (!b.spec.spawn || !tutorialDorm) continue;
      surplus = b.spec.zombies - 2;
      const L = C.Config.level;
      // 205：走廊中段那间，门被家具从里面顶死
      const m2 = b.floorsMeta[1];
      const room205 = m2.rooms[Math.floor(m2.rooms.length / 2)];
      const rb = room205.bounds;
      spawns.push({ type: 'Wanderer', buildingId: b.spec.id, spotKind: 'room', lockedIn: true,
                    tutorialRole: 'classroom205',
                    pos: V.make((rb.min.x + rb.max.x) / 2, m2.y0 + 0.02, (rb.min.z + rb.max.z) / 2) });
      // 一楼走廊里那只巡逻的
      const m1 = b.floorsMeta[0];
      const cb1 = m1.corridor.bounds;
      spawns.push({ type: 'Wanderer', buildingId: b.spec.id, spotKind: 'corridor',
                    tutorialRole: 'patrol1F',
                    pos: V.make((cb1.min.x + cb1.max.x) / 2, m1.y0 + 0.02, (cb1.min.z + cb1.max.z) / 2) });
    }

    // 楼内：每栋楼把名额摊到「房间门前的空地」和「走廊」上
    for (const b of built) {
      /* 只有**已经铺过教学分层**的那栋要跳过。
         `[实测]` 写成 `if (b.spec.spawn) continue` 会在非教学局里把宿舍楼整栋漏掉 ——
         26 只凭空消失，全校总数掉到 294，而且不报任何错。 */
      if (b.spec.spawn && tutorialDorm) continue;
      const spots = [];
      for (const meta of b.floorsMeta) {
        for (const room of meta.rooms) {
          const bb = room.bounds;
          // 门前 0.75m 的空地：所有房型的家具都从 1.3m 往里摆，这条带子一定是空的
          spots.push({ kind: 'room', pos: V.make((bb.min.x + bb.max.x) / 2, meta.y0 + 0.02, bb.min.z + 0.75) });
        }
        const cb = meta.corridor.bounds;
        const n = Math.max(2, Math.round((cb.max.x - cb.min.x) / 9));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          spots.push({ kind: 'corridor',
            pos: V.make(cb.min.x + (cb.max.x - cb.min.x) * t, meta.y0 + 0.02, (cb.min.z + cb.max.z) / 2) });
        }
      }
      rng.shuffle(spots);
      for (let i = 0; i < b.spec.zombies; i++) {
        const s = spots[i % spots.length];
        // 名额比落点多时才抖开，抖动幅度控制在「门前空地」之内
        const extra = i >= spots.length;
        spawns.push({ type: 'Wanderer', buildingId: b.spec.id, spotKind: s.kind,
          pos: V.make(s.pos.x + (extra ? rng.range(-0.8, 0.8) : 0),
                      s.pos.y,
                      s.pos.z + (extra ? rng.range(-0.25, 0.25) : 0)) });
      }
    }

    /* 室外：在分区里撒点，避开楼的占地。
       出生楼省下来的名额按比例摊到各室外分区 —— **全校总数必须还是 320**。 */
    const outTotal = cfg.outdoorZombies.reduce((n, s2) => n + s2.count, 0);
    let given = 0;
    for (let oi = 0; oi < cfg.outdoorZombies.length; oi++) {
      const spec = cfg.outdoorZombies[oi];
      const extra = oi === cfg.outdoorZombies.length - 1
        ? surplus - given                                   // 最后一个补齐余数
        : Math.round(surplus * spec.count / outTotal);
      given += extra;
      const count = spec.count + extra;
      const z = cfg.zones.find(q => q.id === spec.zone);
      for (let i = 0; i < count; i++) {
        let x = 0, zz = 0;
        for (let tries = 0; tries < 30; tries++) {
          x = rng.range(Math.max(z.x0, cfg.wall.x0 + 2), Math.min(z.x1, cfg.wall.x1 - 2));
          zz = rng.range(Math.max(z.z0, cfg.wall.z0 + 2), Math.min(z.z1, cfg.wall.z1 - 2));
          if (!insideAnyBuilding(built, x, zz, 1.5)) break;
        }
        spawns.push({ type: 'Wanderer', zoneId: spec.zone, spotKind: 'outdoor', pos: V.make(x, 0.02, zz) });
      }
    }

    /* 配比：先全按游荡者放好，再确定性地挑出蜷伏者与奔行者。
       蜷伏者只藏在房间里（它的玩法价值是「屏息才能发现」，撂在走廊中间没有意义）。 */
    const nCrawler = Math.round(spawns.length * cfg.crawlerRatio);
    const nRunner = Math.round(spawns.length * cfg.runnerRatio);
    const roomIdx = spawns.map((s, i) => (s.spotKind === 'room' ? i : -1)).filter(i => i >= 0);
    rng.shuffle(roomIdx);
    for (let i = 0; i < nCrawler && i < roomIdx.length; i++) spawns[roomIdx[i]].type = 'Crawler';
    const rest = spawns.map((s, i) => (s.type === 'Wanderer' ? i : -1)).filter(i => i >= 0);
    rng.shuffle(rest);
    for (let i = 0; i < nRunner && i < rest.length; i++) {
      // 第 12 天之前它就是一只普通游荡者，到点才「醒过来」
      spawns[rest[i]].becomesRunner = true;
    }
    return spawns;
  }

  /**
   * @param {object} opts  { spawn:[楼id,楼层,房间序号], tutorial:bool }
   *   出生点由角色决定（角色规格 2.0）。**换角色不是换一张属性表，是换一整个开局** ——
   *   所以出生点必须能被外面指定，而不是写死在 402。
   */
  function buildCampus(opts) {
    opts = opts || {};
    const cfg = C.Config.campus;
    const L = C.Config.level;
    const g = new C.SoundGraph();
    const solids = [], doors = [];
    const H = L.floorHeight;

    // 地面：整块。围墙外也铺一点，免得站在门口看见虚空
    const w = cfg.wall;
    solids.push({ tag: 'ground', box: AABB.make(w.x0 - 14, -1.0, w.z0 - 14, w.x1 + 14, 0, w.z1 + 14) });
    buildPerimeter(solids, cfg);
    buildOutdoorStructures(solids, cfg);

    /* 先建楼、后建室外分区。室外分区是覆盖整条带的大盒子，几何上把楼包在里面，
       getNodeAt 已经做了「室内优先」，这里的顺序只是让 node id 读起来顺一些。 */
    const zoneNodes = new Map();
    const built = [];
    const pending = [];       // 楼建完才有室外节点 id，窗户 Portal 只能等一轮

    // ── 十三栋楼 ─────────────────────────────────────
    for (let bi = 0; bi < cfg.buildings.length; bi++) {
      const spec = cfg.buildings[bi];
      const prefix = spec.prefix;
      const b = C.buildBuildingInto(g, solids, doors, {
        buildingId: bi + 1, name: spec.name, prefix,
        ox: spec.ox, oz: spec.oz, floors: spec.floors, roomsPerFloor: spec.rooms,
        roomW: spec.roomW, roomD: spec.roomD, roomGap: spec.roomGap, corridorD: spec.corridorD,
        stairSides: spec.stairs,
        roomName: (f, i) => prefix + ((f + 1) * 100 + (i + 1)),
        furniture: FURNITURE[spec.roomType] || C.dormFurniture,
        entrance: true,
        // 室外节点还没建，先记下来，回头补
        outFrontId: null, outBackId: null,
        doorOpen: (f, i) => (i % 3 === 0) && !(spec.spawn && f === L.spawnRoomFloor && i === L.spawnRoomIndex)
      });
      b.spec = spec;
      b.buildingId = bi + 1;
      b.name = spec.name;
      built.push(b);
      pending.push({ spec, b });
    }

    // ── 八个室外分区 ─────────────────────────────────
    for (const z of cfg.zones) {
      const node = g.addNode({
        name: z.name, kind: 'outdoor', isOutdoor: true, floor: -1, zoneId: z.id,
        bounds: AABB.make(z.x0, cfg.zoneY.min, z.z0, z.x1, cfg.zoneY.max, z.z1)
      });
      node.zoneId = z.id;
      zoneNodes.set(z.id, node);
    }
    for (const [a, b] of cfg.zoneLinks) {
      const na = zoneNodes.get(a), nb = zoneNodes.get(b);
      const ca = AABB.center(na.bounds), cb = AABB.center(nb.bounds);
      g.addPortal({ nodeA: na.id, nodeB: nb.id, type: PortalType.OpenAir, state: PortalState.Open,
                    position: V.make((ca.x + cb.x) / 2, 1.5, (ca.z + cb.z) / 2) });
    }

    /* ── 把每栋楼的门窗接到它所在的室外分区 ───────────
       模板生成时室外节点还不存在，所以窗和大门的 Portal 在这里补。
       门窗的几何（doors 里的 box）在模板里已经建好了，两边共用同一个 portalId。 */
    for (const { spec, b } of pending) {
      const zone = zoneNodes.get(spec.zone);
      for (const meta of b.floorsMeta) {
        const cb = meta.corridor.bounds;
        // 走廊南窗
        const winA = spec.ox + b.corridorLen * 0.35, winB = winA + 1.4;
        const cw = g.addPortal({
          nodeA: meta.corridor.id, nodeB: zone.id, type: PortalType.Window, state: PortalState.Closed,
          position: V.make((winA + winB) / 2, meta.y0 + 1.5, spec.oz)
        });
        doors.push({ portalId: cw.id, kind: 'window', bid: b.buildingId,
          box: AABB.make(winA, meta.y0 + 1.0, spec.oz - L.wallThickness, winB, meta.y0 + 2.0, spec.oz) });
        // 一层大门
        if (meta.floor === 0) {
          const dA = spec.ox + b.corridorLen * 0.62, dB = dA + 1.6;
          const ep = g.addPortal({
            nodeA: meta.corridor.id, nodeB: zone.id, type: PortalType.SteelDoor, state: PortalState.Closed,
            position: V.make((dA + dB) / 2, meta.y0 + 1.1, spec.oz)
          });
          doors.push({ portalId: ep.id, kind: 'door', bid: b.buildingId,
            box: AABB.make(dA, meta.y0, spec.oz - L.wallThickness, dB, meta.y0 + 2.2, spec.oz) });
          meta.entrancePortal = ep;
          b.entrance = V.make((dA + dB) / 2, 0, spec.oz - 1.2);
        }
        // 每间房的北窗
        for (const room of meta.rooms) {
          const rb = room.bounds;
          const wA = rb.min.x + 1.2, wB = wA + 1.6;
          const wp = g.addPortal({
            nodeA: room.id, nodeB: zone.id, type: PortalType.Window, state: PortalState.Closed,
            position: V.make((wA + wB) / 2, meta.y0 + 1.5, rb.max.z)
          });
          doors.push({ portalId: wp.id, kind: 'window', bid: b.buildingId,
            box: AABB.make(wA, meta.y0 + 1.0, rb.max.z, wB, meta.y0 + 2.0, rb.max.z + L.wallThickness) });
        }
      }
      b.zoneId = spec.zone;
      b.zoneNodeId = zone.id;
    }

    /* ── 出生点（13.2 + 角色规格 2.0）──────────────────
       默认男生宿舍楼 402；角色可以把它换到体育馆、食堂、保安室…… */
    const want = opts.spawn || ['dormM', L.spawnRoomFloor, L.spawnRoomIndex];
    const home = built.find(b => b.spec.id === want[0]) || built.find(b => b.spec.spawn);
    // 楼层/房间号越界就夹回去 —— 医务室只有 1 层 3 间，写错一个数不该把整局炸掉
    const fl = Math.max(0, Math.min(home.floorsMeta.length - 1, want[1] | 0));
    const rooms = home.floorsMeta[fl].rooms;
    const spawnRoom = rooms[Math.max(0, Math.min(rooms.length - 1, want[2] | 0))];
    const src = AABB.center(spawnRoom.bounds);
    const spawn = { x: src.x, y: fl * H + 0.02, z: src.z, yaw: 0 };

    const rng = new C.Rng(cfg.zombieSeed);
    const zombieSpawns = placeZombies(built, cfg, rng, opts.tutorial !== false);

    const floorsMeta = [];
    for (const b of built) for (const m of b.floorsMeta) floorsMeta.push(m);
    const maxFloors = built.reduce((n, b) => Math.max(n, b.spec.floors), 1);

    /* ── 配电回路（烹饪与供电规格 2.2）──────────────────
       每栋楼一条回路，配电箱在一层走廊的西端。
       **出生的 402 所在回路开关是断开的** —— 开局第一个真正的目标是
       「从四楼下到一楼，推上闸，再回来」，全程有丧尸。
       这是一个完美的教学关卡，而且它把「探索这栋楼」变成了具体的、有回报的目标。 */
    /* ── 插座 ────────────────────────────────────────
       `[实测]` **原来整栋楼一个插座都没有。**
       电水壶、电磁炉、冰箱全都只能靠代码凭空创建链路 ——
       教学的第三个目标「水壶要接电，找个插座」在游戏里根本做不到。

       每个房间靠门那面墙上一个，走廊每隔一段一个。
       插座属于所在楼的回路：**闸没推就是没电**，这一点是教学目标 3 的全部内容。 */
    const outlets = [];
    for (const b of built) {
      for (let fi = 0; fi < b.floorsMeta.length; fi++) {
        const meta = b.floorsMeta[fi];
        for (const room of meta.rooms) {
          const bb = room.bounds;
          outlets.push({
            id: 'oc-' + b.spec.id + '-' + fi + '-' + room.name,
            name: room.name + ' 插座', circuitId: 'circuit-' + b.spec.id + '-' + fi, buildingId: b.buildingId,
            // 贴着门那面墙（房间的南墙），离地 0.35m —— 真实插座就在这个高度
            pos: V.make((bb.min.x + bb.max.x) / 2 - 0.9, meta.y0 + 0.35, bb.min.z + 0.12)
          });
        }
        const cb = meta.corridor.bounds;
        const n = Math.max(1, Math.round((cb.max.x - cb.min.x) / 14));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          outlets.push({
            id: 'oc-' + b.spec.id + '-' + fi + '-h' + i,
            name: b.name + (fi + 1) + '楼走廊插座', circuitId: 'circuit-' + b.spec.id + '-' + fi,
            buildingId: b.buildingId,
            pos: V.make(cb.min.x + (cb.max.x - cb.min.x) * t, meta.y0 + 0.35, cb.max.z - 0.12)
          });
        }
      }
    }

    /* ── 配电回路：**一层一个分闸**（供电规格 2.2）────────
       `[实测]` 原来是「一栋楼一条回路」，而出生楼那条是断的 ——
       于是玩家在宿舍楼里走遍四层，**32 个插座全是死的**。
       第一次接触「电」这个系统，看到的是三十多个坏掉的插座，
       他学到的不是「要去推闸」，是「这游戏的插座没做完」。

       改成一层一个分闸之后：**开局只有出生的那一层是断的**，
       下一层楼的插座就是好的 —— 玩家立刻知道「不是水壶坏了，是我这层没电」，
       而这正好是把他推向一楼配电间的那句话（教学目标 3 → 6）。

       配电箱是一栋楼一个，在一层走廊西端，里面是这栋楼所有楼层的分闸。 */
    const circuits = [];
    for (const b of built) {
      const m0 = b.floorsMeta[0];
      const cb = m0.corridor.bounds;
      const panelAt = V.make(cb.min.x + 1.2, m0.y0 + 1.2, (cb.min.z + cb.max.z) / 2);
      for (let f = 0; f < b.floorsMeta.length; f++) {
        circuits.push({
          id: 'circuit-' + b.spec.id + '-' + f,
          name: b.name + ' ' + (f + 1) + '楼',
          buildingId: b.buildingId, floor: f, panelBuilding: b.spec.id,
          // **只有出生的那一层是断的**
          breakerOn: !(b.spec.id === home.spec.id && f === fl),
          panelAt
        });
      }
    }

    /* 配电箱：一栋楼一个，玩家能走到跟前按 F 的实体。
       `[实测]` 在这之前 `panelAt` 只是一个存在数据里的坐标，
       **没有任何东西渲染它，也没有任何办法跟它交互** ——
       教学目标 6「配电间在一楼」和插座一样，是做不到的。 */
    const panels = built.map((b) => {
      const m0 = b.floorsMeta[0];
      const cb = m0.corridor.bounds;
      return {
        id: 'panel-' + b.spec.id, name: b.name + ' 配电箱',
        buildingId: b.buildingId, buildingKey: b.spec.id,
        pos: V.make(cb.min.x + 1.2, m0.y0 + 1.2, (cb.min.z + cb.max.z) / 2)
      };
    });

    return {
      isCampus: true,
      graph: g, solids, doors, spawn, zombieSpawns, circuits, outlets, panels,
      portalInitialStates: g.portals.map(p => p.state),
      buildings: built, zones: cfg.zones, zoneNodes, exits: cfg.exits,
      floorsMeta, corridorLen: home.corridorLen, roomZ0: home.roomZ0, roomZ1: home.roomZ1,
      bounds: { minX: w.x0 - 14, maxX: w.x1 + 14, minZ: w.z0 - 14, maxZ: w.z1 + 14,
                floors: maxFloors, floorHeight: H }
    };
  }

  C.CampusFurniture = FURNITURE;
  C.buildCampus = buildCampus;
})(typeof globalThis !== 'undefined' ? globalThis : this);
