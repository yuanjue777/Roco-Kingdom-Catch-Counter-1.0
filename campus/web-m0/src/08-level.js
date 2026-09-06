/*
 * 08-level.js —— 灰盒建筑生成（主文档 13.1 / 13.5）
 *
 * 一栋楼的几何与它的声音连通图由**同一段代码**推导出来。分成两份手工维护的话，
 * 会出现「声图上有门、几何上是墙」这类几乎无法察觉的 bug。
 *
 * 这里有两层：
 *   buildBuildingInto()  通用板楼模板 —— 一条走廊 + 一排房间 + 0~2 个楼梯间
 *   buildDormitory()     M0/M1 的单栋宿舍楼关卡（模板 + 出生点 + 4 只丧尸）
 * 全校地图（M2）在 24-campus.js 里调同一个模板生成十几栋楼，不另写一套几何。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const { AABB, V, PortalType, PortalState } = C;

  /** 在一面墙上开洞：把墙拆成 左/右/下/上 若干块实体 */
  function wallWithHoles(out, tag, axis, fixedLo, fixedHi, a0, a1, y0, y1, holes) {
    const box = (aLo, aHi, yLo, yHi) => {
      if (aHi - aLo < 1e-4 || yHi - yLo < 1e-4) return;
      out.push({
        tag,
        box: axis === 'x'
          ? AABB.make(aLo, yLo, fixedLo, aHi, yHi, fixedHi)   // 沿 x 延伸的墙
          : AABB.make(fixedLo, yLo, aLo, fixedHi, yHi, aHi)   // 沿 z 延伸的墙
      });
    };
    const sorted = (holes || []).slice().sort((p, q) => p.a0 - q.a0);
    let cursor = a0;
    for (const h of sorted) {
      box(cursor, h.a0, y0, y1);
      box(h.a0, h.a1, y0, h.y0);
      box(h.a0, h.a1, h.y1, y1);
      cursor = h.a1;
    }
    box(cursor, a1, y0, y1);
  }

  /** 宿舍标准间：两张上下铺 + 一张桌子。既是掩体，也是蜷伏者的藏身处。 */
  function dormFurniture(out, rx0, rx1, y0, z0, z1) {
    out.push({ tag: 'bed', box: AABB.make(rx0 + 0.15, y0, z0 + 0.3, rx0 + 1.15, y0 + 0.55, z0 + 2.3) });
    out.push({ tag: 'bed', box: AABB.make(rx1 - 1.15, y0, z0 + 0.3, rx1 - 0.15, y0 + 0.55, z0 + 2.3) });
    out.push({ tag: 'desk', box: AABB.make(rx0 + 1.3, y0, z1 - 1.0, rx1 - 1.3, y0 + 0.75, z1 - 0.3) });
  }

  /**
   * 通用板楼：一条走廊（南）+ 一排房间（北）+ 若干楼梯间。
   * 所有坐标都相对 spec.ox / spec.oz，所以同一段代码可以在校园里摆很多份。
   *
   * @returns {floorsMeta, stairNodes, corridorLen, roomZ0, roomZ1, footprint}
   */
  function buildBuildingInto(g, solids, doors, spec) {
    const L = C.Config.level;
    const H = spec.floorHeight || L.floorHeight;
    const T = spec.wallThickness || L.wallThickness;
    const roomW = spec.roomW || L.roomW, roomD = spec.roomD || L.roomD;
    const roomGap = spec.roomGap === undefined ? L.roomGap : spec.roomGap;
    const corridorD = spec.corridorD || L.corridorD;
    const floors = spec.floors, nRooms = spec.roomsPerFloor;
    const ox = spec.ox || 0, oz = spec.oz || 0;
    const bid = spec.buildingId === undefined ? 1 : spec.buildingId;
    const sides = spec.stairSides || [];
    const stairWellW = spec.stairWellW || L.stairWellW, stairWellD = spec.stairWellD || L.stairWellD;
    const stairWidth = spec.stairWidth || L.stairWidth;
    const roomName = spec.roomName || ((f, i) => String((f + 1) * 100 + (i + 1)));
    const furniture = spec.furniture || dormFurniture;
    const label0 = spec.name ? spec.name : '';

    const pitch = roomW + roomGap;
    const corridorLen = (nRooms - 1) * pitch + roomW;
    const roomZ0 = oz + corridorD, roomZ1 = oz + corridorD + roomD;
    const cx0 = ox - 0.4, cx1 = ox + corridorLen + 0.4;
    const westX1 = cx0, westX0 = westX1 - stairWellW;
    const eastX0 = cx1, eastX1 = eastX0 + stairWellW;

    const stairNodes = sides.map(() => []);
    const floorsMeta = [];
    // 这一段里 push 进 solids 的每一块都属于这栋楼，末尾统一打 bid。
    // 分区加载靠它来决定「哪一批盒子现在要不要出现在场景里」。
    const solidsStart = solids.length, doorsStart = doors.length;

    for (let f = 0; f < floors; f++) {
      const y0 = f * H + (spec.baseY || 0), y1 = y0 + H;
      const label = (f + 1) + 'F';
      const meta = { floor: f, y0, rooms: [], corridor: null, stairs: [], buildingId: bid };

      // ── 走廊 ────────────────────────────────────────
      const corridor = g.addNode({
        name: (spec.prefix || '') + label + '走廊', kind: 'corridor', floor: f, buildingId: bid,
        bounds: AABB.make(cx0, y0, oz - 0.1, cx1, y1, roomZ0)
      });
      meta.corridor = corridor;

      /* 楼板 + 天花板。x 范围只覆盖「走廊 + 房间」，**不能盖到楼梯间上面** ——
         楼梯间是贯通的竖井，盖上楼板的话上楼时会顶到天花板。 */
      solids.push({ tag: 'floor', box: AABB.make(cx0, y0 - 0.2, oz - 0.1, cx1, y0, roomZ1) });
      if (f === floors - 1) solids.push({ tag: 'roof', box: AABB.make(cx0, y1, oz - 0.1, cx1, y1 + 0.2, roomZ1) });

      // 走廊南墙：一扇窗（通向楼前），一层再开一道大门
      const winA = ox + corridorLen * 0.35, winB = winA + 1.4;
      const southHoles = [{ a0: winA, a1: winB, y0: y0 + 1.0, y1: y0 + 2.0 }];
      const doorA = ox + corridorLen * 0.62, doorB = doorA + 1.6;
      const hasEntrance = spec.entrance && f === 0;
      if (hasEntrance) southHoles.push({ a0: doorA, a1: doorB, y0: y0, y1: y0 + 2.2 });
      wallWithHoles(solids, 'wall', 'x', oz - T, oz, cx0, cx1, y0, y1, southHoles);

      if (spec.outFrontId !== undefined && spec.outFrontId !== null) {
        const cw = g.addPortal({
          nodeA: corridor.id, nodeB: spec.outFrontId, type: PortalType.Window, state: PortalState.Closed,
          position: V.make((winA + winB) / 2, y0 + 1.5, oz - T / 2)
        });
        doors.push({ portalId: cw.id, kind: 'window',
          box: AABB.make(winA, y0 + 1.0, oz - T, winB, y0 + 2.0, oz) });
        if (hasEntrance) {
          const ep = g.addPortal({
            nodeA: corridor.id, nodeB: spec.outFrontId, type: PortalType.SteelDoor, state: PortalState.Closed,
            position: V.make((doorA + doorB) / 2, y0 + 1.1, oz - T / 2)
          });
          doors.push({ portalId: ep.id, kind: 'door',
            box: AABB.make(doorA, y0, oz - T, doorB, y0 + 2.2, oz) });
          meta.entrancePortal = ep;
          meta.entrancePos = V.make((doorA + doorB) / 2, y0, oz - T * 1.5);
        }
      }

      // ── 房间 ───────────────────────────────────────
      const roomHoles = [];   // 走廊北墙上的门洞
      for (let i = 0; i < nRooms; i++) {
        const rx0 = ox + i * pitch, rx1 = rx0 + roomW;
        const node = g.addNode({
          name: roomName(f, i), kind: 'room', floor: f, buildingId: bid,
          bounds: AABB.make(rx0, y0, roomZ0, rx1, y1, roomZ1)
        });
        meta.rooms.push(node);

        // 房间左右隔墙（相邻房间之间的实心块，含 roomGap）
        if (roomGap > 0) solids.push({ tag: 'wall', box: AABB.make(rx1, y0, roomZ0, rx1 + roomGap, y1, roomZ1) });
        if (i === 0) solids.push({ tag: 'wall', box: AABB.make(rx0 - T, y0, roomZ0, rx0, y1, roomZ1) });

        // 房间门（走廊北墙上的洞）
        const dcx = rx0 + roomW * 0.5, dw = 1.0;
        roomHoles.push({ a0: dcx - dw / 2, a1: dcx + dw / 2, y0: y0, y1: y0 + 2.1 });
        const openDoor = spec.doorOpen ? spec.doorOpen(f, i) : (i % 3 === 0);
        const portal = g.addPortal({
          nodeA: corridor.id, nodeB: node.id, type: PortalType.WoodDoor,
          state: openDoor ? PortalState.Open : PortalState.Closed,
          position: V.make(dcx, y0 + 1.05, roomZ0)
        });
        doors.push({ portalId: portal.id, kind: 'door',
          box: AABB.make(dcx - dw / 2, y0, roomZ0 - 0.05, dcx + dw / 2, y0 + 2.1, roomZ0 + 0.05) });

        // 房间北墙（带窗，通向楼后）
        const wA = rx0 + 1.2, wB = wA + 1.6;
        wallWithHoles(solids, 'wall', 'x', roomZ1, roomZ1 + T, rx0, rx1, y0, y1,
          [{ a0: wA, a1: wB, y0: y0 + 1.0, y1: y0 + 2.0 }]);
        if (spec.outBackId !== undefined && spec.outBackId !== null) {
          const wp = g.addPortal({
            nodeA: node.id, nodeB: spec.outBackId, type: PortalType.Window, state: PortalState.Closed,
            position: V.make((wA + wB) / 2, y0 + 1.5, roomZ1 + T / 2)
          });
          doors.push({ portalId: wp.id, kind: 'window',
            box: AABB.make(wA, y0 + 1.0, roomZ1, wB, y0 + 2.0, roomZ1 + T) });
        }

        furniture(solids, rx0, rx1, y0, roomZ0, roomZ1, f, i);
      }
      // 走廊北墙（挖出每间房的门洞）
      wallWithHoles(solids, 'wall', 'x', roomZ0 - T, roomZ0, cx0, cx1, y0, y1, roomHoles);

      // ── 楼梯间 ─────────────────────────────────────
      sides.forEach((side, si) => {
        const west = side === 'west';
        const sx0 = west ? westX0 : eastX0, sx1 = west ? westX1 : eastX1;
        const node = g.addNode({
          name: (spec.prefix || '') + (west ? '西' : '东') + '楼梯' + label, kind: 'stair', floor: f, buildingId: bid,
          bounds: AABB.make(sx0, y0, oz - 0.1, sx1, y1, oz + stairWellD)
        });
        meta.stairs.push(node);
        stairNodes[si].push(node);

        // 走道半幅（靠走廊那一侧）
        const walk0 = west ? sx1 - 2.9 : sx0, walk1 = west ? sx1 : sx0 + 2.9;
        solids.push({ tag: 'floor', box: AABB.make(walk0, y0 - 0.2, oz - 0.1, walk1, y0, oz + stairWellD) });
        node.walkCenterX = (walk0 + walk1) / 2;

        const st0 = west ? sx0 + 0.3 : sx1 - 0.3 - stairWidth;
        node.stairCenterX = st0 + stairWidth / 2;   // 寻路要走到梯段上，不能只走到节点中心
        const steps = Math.round(H / L.stairStepH);
        const stairZ0 = oz + 0.5, stairZ1 = stairZ0 + steps * L.stairStepD;
        node.stairZ1 = stairZ1;

        /* 梯段上下两端的落脚平台每层都有；**梯段区必须留空** ——
           那是从下一层上来的楼梯的洞。曾经把顶层整个铺平，结果出生的四楼下不去。 */
        solids.push({ tag: 'floor', box: AABB.make(sx0, y0 - 0.2, oz - 0.1, sx1, y0, stairZ0) });
        solids.push({ tag: 'floor', box: AABB.make(sx0, y0 - 0.2, stairZ1, sx1, y0, oz + stairWellD) });
        if (f === floors - 1) {
          solids.push({ tag: 'roof', box: AABB.make(sx0 - T, y1, oz - 0.1, sx1 + T, y1 + 0.2, oz + stairWellD + T) });
        } else {
          /* 梯段：沿 +z 上行，占另外半幅。
             踏板要有厚度（挡住从侧面爬），但不能做成从楼板一直填到踏面的实心柱 ——
             那样上一层的梯段会把这一层楼梯的头顶空间占满，爬到一半就会顶头。 */
          for (let s = 0; s < steps; s++) {
            const zz = stairZ0 + s * L.stairStepD;
            const top = y0 + (s + 1) * L.stairStepH;
            solids.push({ tag: 'stair',
              box: AABB.make(st0, top - L.stairSlabThickness, zz, st0 + stairWidth, top, zz + L.stairStepD) });
          }
        }

        /* 楼梯间外墙。只砌远离走廊那一侧的外墙 —— 靠走廊那一侧由下面的 wallWithHoles 砌，
           因为那面墙上要留门洞，两边都砌的话门洞会被这堵实心墙糊死。 */
        if (west) solids.push({ tag: 'wall', box: AABB.make(sx0 - T, y0, oz - 0.1, sx0, y1, oz + stairWellD) });
        else      solids.push({ tag: 'wall', box: AABB.make(sx1, y0, oz - 0.1, sx1 + T, y1, oz + stairWellD) });
        solids.push({ tag: 'wall', box: AABB.make(sx0 - T, y0, oz + stairWellD, sx1 + T, y1, oz + stairWellD + T) });
        solids.push({ tag: 'wall', box: AABB.make(sx0 - T, y0, oz - T, sx1 + T, y1, oz - 0.1) });

        // 楼梯间 ↔ 走廊：门洞（无门）
        const gx = west ? westX1 : eastX0;
        const gz0 = oz + 0.6, gz1 = oz + 1.8;
        wallWithHoles(solids, 'wall', 'z', gx - T / 2, gx + T / 2, oz - 0.1, oz + stairWellD, y0, y1,
          [{ a0: gz0, a1: gz1, y0: y0, y1: y0 + 2.1 }]);
        g.addPortal({
          nodeA: node.id, nodeB: corridor.id, type: PortalType.Doorway, state: PortalState.Open,
          position: V.make(gx, y0 + 1.05, (gz0 + gz1) / 2)
        });
      });

      floorsMeta.push(meta);
    }

    // ── 楼层之间的楼梯口 Portal ───────────────────────
    for (let si = 0; si < stairNodes.length; si++) {
      for (let f = 0; f < floors - 1; f++) {
        const a = stairNodes[si][f], b = stairNodes[si][f + 1];
        const cx = a.stairCenterX;
        const y = (spec.baseY || 0);
        const p = g.addPortal({
          nodeA: a.id, nodeB: b.id, type: PortalType.Stairwell, state: PortalState.Open,
          position: V.make(cx, y + (f + 1) * H, oz + stairWellD - 1.0)
        });
        /* 寻路专用：从 nodeA 一侧上行的顺序路点（下行时整体反向）。
           四个点缺一不可 —— 只给「梯段中点」的话，丧尸会从走道斜切过去撞在
           梯段侧面，因为台阶侧壁高度超过 stepHeight 爬不上去。
             ① 走道上对齐梯脚 → ② 梯脚 → ③ 梯顶 → ④ 上一层走道 */
        const zTop = a.stairZ1 + 0.35;
        p.waypoints = [
          V.make(a.walkCenterX, y + f * H, oz + 0.2),
          V.make(cx, y + f * H, oz + 0.2),
          V.make(cx, y + (f + 1) * H, zTop),
          V.make(b.walkCenterX, y + (f + 1) * H, zTop)
        ];
      }
    }

    for (let i = solidsStart; i < solids.length; i++) solids[i].bid = bid;
    for (let i = doorsStart; i < doors.length; i++) doors[i].bid = bid;

    const fx0 = (sides.includes('west') ? westX0 : cx0) - T;
    const fx1 = (sides.includes('east') ? eastX1 : cx1) + T;
    return {
      floorsMeta, stairNodes, corridorLen, roomZ0, roomZ1,
      footprint: { x0: fx0, x1: fx1, z0: oz - T, z1: roomZ1 + T },
      topY: (spec.baseY || 0) + floors * H
    };
  }

  function buildDormitory() {
    const L = C.Config.level;
    const g = new C.SoundGraph();
    const solids = [];          // 静态实体：{tag, box}
    const doors = [];           // 门/窗：{portalId, box, kind}
    const H = L.floorHeight, T = L.wallThickness;
    const pitch = L.roomW + L.roomGap;
    const corridorLen = (L.roomsPerFloor - 1) * pitch + L.roomW;   // 29m
    const roomZ1 = L.corridorD + L.roomD;
    const westX0 = -0.4 - L.stairWellW, eastX1 = corridorLen + 0.4 + L.stairWellW;

    // ── 室外（两片，绕楼一圈，用于验证室外 k=1.2 与开窗引怪）──
    const outFront = g.addNode({
      name: '楼前空地', kind: 'outdoor', isOutdoor: true, floor: -1,
      bounds: AABB.make(westX0 - 10, -0.5, -14, eastX1 + 10, H * L.floors + 2, -0.3)
    });
    const outBack = g.addNode({
      name: '楼后空地', kind: 'outdoor', isOutdoor: true, floor: -1,
      bounds: AABB.make(westX0 - 10, -0.5, roomZ1 + 0.3, eastX1 + 10, H * L.floors + 2, roomZ1 + 16)
    });
    g.addPortal({ nodeA: outFront.id, nodeB: outBack.id, type: PortalType.OpenAir, state: PortalState.Open,
                  position: V.make(westX0 - 8, 1.5, roomZ1 / 2) });
    g.addPortal({ nodeA: outFront.id, nodeB: outBack.id, type: PortalType.OpenAir, state: PortalState.Open,
                  position: V.make(eastX1 + 8, 1.5, roomZ1 / 2) });
    // 室外地面
    solids.push({ tag: 'ground', box: AABB.make(westX0 - 12, -1.0, -16, eastX1 + 12, 0, roomZ1 + 18) });

    const b = buildBuildingInto(g, solids, doors, {
      buildingId: 1, ox: 0, oz: 0,
      floors: L.floors, roomsPerFloor: L.roomsPerFloor,
      stairSides: ['west', 'east'],
      outFrontId: outFront.id, outBackId: outBack.id,
      entrance: false,
      // 出生的那间必须是关着的：开局第一个决定就是怎么开这扇门
      doorOpen: (f, i) => (i % 3 === 0) && !(f === L.spawnRoomFloor && i === L.spawnRoomIndex)
    });

    // ── 出生点与丧尸布置（主文档 13.2）──────────────────
    const spawnRoom = b.floorsMeta[L.spawnRoomFloor].rooms[L.spawnRoomIndex];
    const src = AABB.center(spawnRoom.bounds);
    // 面朝房门：开局第一件事就是决定怎么开这扇门（快速还是缓慢）
    const spawn = { x: src.x, y: L.spawnRoomFloor * H + 0.02, z: src.z, yaw: 0 };

    const corridorZ = L.corridorD * 0.5;
    const zombieSpawns = [
      // 第一只丧尸在三楼楼梯口，玩家必须绕开（此时没有任何武器）
      { type: 'Wanderer', pos: V.make(-0.4 - 1.5, 2 * H + 0.02, 1.2), homeNode: null },
      { type: 'Wanderer', pos: V.make(corridorLen * 0.55, 1 * H + 0.02, corridorZ) },
      { type: 'Wanderer', pos: V.make(corridorLen * 0.75, 0 * H + 0.02, corridorZ) },
      // 蜷伏者藏在玩家出生层的另一间宿舍里 —— 教玩家屏息侦查
      { type: 'Crawler', pos: (() => {
          const r = AABB.center(b.floorsMeta[L.spawnRoomFloor].rooms[4].bounds);
          return V.make(r.x, L.spawnRoomFloor * H + 0.02, r.z + 1.2);
        })() }
    ];

    return {
      graph: g, solids, doors, spawn, zombieSpawns,
      // 出厂状态快照：存档只记与它不同的 Portal
      portalInitialStates: g.portals.map(p => p.state),
      floorsMeta: b.floorsMeta, corridorLen: b.corridorLen, roomZ0: b.roomZ0, roomZ1: b.roomZ1,
      bounds: { minX: westX0 - 12, maxX: eastX1 + 12, minZ: -16, maxZ: roomZ1 + 18, floors: L.floors, floorHeight: H }
    };
  }

  C.wallWithHoles = wallWithHoles;
  C.dormFurniture = dormFurniture;
  C.buildBuildingInto = buildBuildingInto;
  C.buildDormitory = buildDormitory;
})(typeof globalThis !== 'undefined' ? globalThis : this);
