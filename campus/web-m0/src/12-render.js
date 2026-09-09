/*
 * 12-render.js —— 灰盒渲染（three.js r128）
 * 只读规则层的状态，不反向写入。静态几何用 InstancedMesh，几百个盒子一次 draw call。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  const COLORS = {
    floor: 0x5a5f6b, wall: 0x82868f, roof: 0x4c505a, stair: 0x6e7a8c,
    bed: 0x8a6f52, desk: 0x9a7f5f, ground: 0x3f4a3c
  };

  function Renderer(canvas, level) {
    this.level = level;
    this.three = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.three.setPixelRatio(Math.min(devicePixelRatio, (C.Touch && C.Touch.enabled) ? 1.25 : 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x11131a);
    this.scene.fog = new THREE.Fog(0x11131a, C.Config.render.fogNear, C.Config.render.fogFar);
    this.camera = new THREE.PerspectiveCamera(78, 1, 0.05, 300);

    this.hemi = new THREE.HemisphereLight(0xbdd0ff, 0x4e4e58, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff3e0, 0.55);
    this.sun.position.set(30, 60, 20);
    this.scene.add(this.sun);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(this.ambient);

    // 手电（主文档 3.1 / 4.5）
    this.torch = new THREE.SpotLight(0xfff0c8, 0, 26, Math.PI / 7, 0.45, 1.2);
    this.torchTarget = new THREE.Object3D();
    this.scene.add(this.torch, this.torchTarget);
    this.torch.target = this.torchTarget;

    this._buildStatic();
    this._buildZombies();
    this._buildDoors();
    this._buildThrowPreview();
    this._buildAvatar();
    this._buildContainers();
    this._buildOutlets();
    this.stoneMeshes = [];
  }

  /* 投掷预览：弹道 + 落点标记 + 引怪半径圈。
     全部预先建好，每帧只改顶点和可见性 —— 原来每帧新建/销毁几何体，纯浪费。 */
  Renderer.prototype._buildThrowPreview = function () {
    const MAX = C.Config.throwing.arcSamples + 2;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    this.arcLine = new THREE.Line(geo, new THREE.LineDashedMaterial({
      color: 0xffd479, dashSize: 0.22, gapSize: 0.16, transparent: true, opacity: 0.95, depthTest: false
    }));
    this.arcLine.renderOrder = 10;
    this.arcLine.frustumCulled = false;
    this.arcLine.visible = false;
    this.scene.add(this.arcLine);

    /* 再叠一层点阵。纯线条在「顺着弹道方向看过去」时会被透视压成几个像素，
       而投石恰恰几乎总是朝着正前方扔 —— 点阵不受这个影响。 */
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    this.arcDots = new THREE.Points(pgeo, new THREE.PointsMaterial({
      color: 0xffd479, size: 0.075, sizeAttenuation: true, transparent: true, opacity: 0.9, depthTest: false
    }));
    this.arcDots.renderOrder = 10;
    this.arcDots.frustumCulled = false;
    this.arcDots.visible = false;
    this.scene.add(this.arcDots);

    // 落点：地面上的实心小环 + 一根竖直标杆，站在高处也看得见落点在哪
    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd479, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false }));
    ring.rotation.x = -Math.PI / 2;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03),
      new THREE.MeshBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.6, depthTest: false }));
    post.position.y = 0.25;
    this.marker.add(ring, post);
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    this.scene.add(this.marker);

    // 引怪半径圈：半径 =(响度−丧尸阈值)/k，直接告诉玩家这一下会惊动多大范围
    const seg = 72, pts = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    this.audibleRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x6FD3E8, transparent: true, opacity: 0.5, depthTest: false }));
    this.audibleRing.renderOrder = 9;
    this.audibleRing.visible = false;
    this.scene.add(this.audibleRing);
  };

  /* 静态几何按「所属建筑」分组，每组内部再按 tag 合成 InstancedMesh。
     分组是为了分区加载（13.4）：卸载一栋楼 = 把它那一组 visible 置 false。
     没有 bid 的（地面、围墙、车棚）属于常驻的室外场景，永远可见。 */
  Renderer.prototype._buildStatic = function () {
    const byBuilding = new Map();
    for (const s of this.level.solids) {
      const key = s.bid === undefined ? 0 : s.bid;
      if (!byBuilding.has(key)) byBuilding.set(key, new Map());
      const byTag = byBuilding.get(key);
      if (!byTag.has(s.tag)) byTag.set(s.tag, []);
      byTag.get(s.tag).push(s.box);
    }
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4();
    this.buildingGroups = new Map();
    for (const [bid, byTag] of byBuilding) {
      const group = new THREE.Group();
      for (const [tag, boxes] of byTag) {
        const mat = new THREE.MeshLambertMaterial({ color: COLORS[tag] || 0x888888 });
        const inst = new THREE.InstancedMesh(unit, mat, boxes.length);
        boxes.forEach((b, i) => {
          m4.makeTranslation((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
          m4.scale(new THREE.Vector3(
            Math.max(0.01, b.max.x - b.min.x),
            Math.max(0.01, b.max.y - b.min.y),
            Math.max(0.01, b.max.z - b.min.z)));
          inst.setMatrixAt(i, m4);
        });
        inst.instanceMatrix.needsUpdate = true;
        group.add(inst);
      }
      if (bid !== 0) this.buildingGroups.set(bid, group);
      this.scene.add(group);
    }
  };

  /** 分区加载回调：只切 visible，不销毁 —— 灰盒阶段几何都在显存里，重建反而更贵 */
  Renderer.prototype.setLoadedBuildings = function (loaded) {
    if (!this.buildingGroups) return;
    for (const [bid, group] of this.buildingGroups) group.visible = loaded.has(bid);
    this._syncDoors();
    this._syncContainers();
  };

  Renderer.prototype._buildDoors = function () {
    this.doorMeshes = [];
    const g = this.level.graph;
    for (const d of this.level.doors) {
      const b = d.box;
      const geo = new THREE.BoxGeometry(
        Math.max(0.06, b.max.x - b.min.x), Math.max(0.06, b.max.y - b.min.y), Math.max(0.06, b.max.z - b.min.z));
      const mat = new THREE.MeshLambertMaterial({
        color: d.kind === 'window' ? 0x7fb4c8 : 0xa2764a,
        transparent: d.kind === 'window', opacity: d.kind === 'window' ? 0.45 : 1
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
      mesh.userData.portalId = d.portalId;
      mesh.userData.bid = d.bid;              // 分区加载：楼卸载了，它的门窗也别画
      this.scene.add(mesh);
      this.doorMeshes.push(mesh);
    }
    this._syncDoors();
    C.EventBus.subscribe(C.Events.PortalStateChanged, () => this._syncDoors());
  };

  Renderer.prototype._syncDoors = function () {
    const g = this.level.graph;
    const S = C.Streaming;
    for (const m of this.doorMeshes) {
      const p = g.getPortal(m.userData.portalId);
      const bid = m.userData.bid;
      const loaded = (bid === undefined) || !S || S.isLoaded(bid);
      m.visible = !g.isPassable(p) && loaded;
    }
  };

  /* 第三人称才看得见的玩家身体 */
  /* 容器与地上的物品：小盒子，颜色按类型分 */
  Renderer.prototype._buildContainers = function () {
    const unit = new THREE.BoxGeometry(1, 1, 1);
    // 和静态几何一样：先按建筑分组（分区加载），组内再按颜色合批
    const byBuilding = new Map();
    for (const c of this.level.containers || []) {
      const key = c.bid === undefined ? 0 : c.bid;
      if (!byBuilding.has(key)) byBuilding.set(key, new Map());
      const byColor = byBuilding.get(key);
      if (!byColor.has(c.color)) byColor.set(c.color, []);
      byColor.get(c.color).push(c);
    }
    const m4 = new THREE.Matrix4();
    this.containerGroups = new Map();
    this.containerSlots = new Map();      // 容器 id → 它在哪个实例网格的第几号，拎走时要抹掉
    for (const [bid, byColor] of byBuilding) {
      const group = new THREE.Group();
      for (const [color, list] of byColor) {
        const inst = new THREE.InstancedMesh(unit, new THREE.MeshLambertMaterial({ color }), list.length);
        list.forEach((c, i) => {
          m4.makeTranslation(c.pos.x, c.pos.y, c.pos.z);
          m4.scale(new THREE.Vector3(c.size[0], c.size[1], c.size[2]));
          inst.setMatrixAt(i, m4);
          this.containerSlots.set(c.id, { inst, i });
        });
        inst.instanceMatrix.needsUpdate = true;
        group.add(inst);
      }
      if (bid !== 0) this.containerGroups.set(bid, group);
      this.scene.add(group);
    }
    this.looseMeshes = (this.level.looseItems || []).map(l => this._makeLoose(l));
  };

  /** 一件散落物的方块。玩家**放下**东西时也走这里，所以要能单独建一个。 */
  Renderer.prototype._makeLoose = function (l) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18),
      // 自己放下的用暖一点的颜色，好在灰盒里认出来
      new THREE.MeshLambertMaterial({ color: l.dropped ? 0xE0B070 : 0xd8d0c0 }));
    m.position.set(l.pos.x, l.pos.y, l.pos.z);
    this.scene.add(m);
    return { mesh: m, loose: l };
  };

  /* ── 玩家摆出来的东西 ────────────────────────────────
     和散落物不同：它们是**立着的实体**，要能一眼认出「那是我放的电水壶」。
     用一个稍大的暖色盒子，比 18cm 的散落物方块明显。 */
  Renderer.prototype.addPlaced = function (placed) {
    if (!this.placedMeshes) this.placedMeshes = [];
    const def = C.ITEMS[placed.itemId];
    const s = def.size || [1, 1];
    const w = Math.min(0.42, 0.14 + s[0] * 0.08), h = Math.min(0.40, 0.16 + s[1] * 0.07);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w),
      new THREE.MeshLambertMaterial({ color: 0xC9D3DC }));
    m.position.set(placed.pos.x, placed.pos.y + h / 2, placed.pos.z);
    m.rotation.y = placed.yaw || 0;
    this.scene.add(m);
    this.placedMeshes.push({ mesh: m, placed });
  };
  Renderer.prototype.removePlaced = function (placed) {
    if (!this.placedMeshes) return;
    const i = this.placedMeshes.findIndex(r => r.placed === placed);
    if (i < 0) return;
    this.scene.remove(this.placedMeshes[i].mesh);
    this.placedMeshes.splice(i, 1);
  };

  /** 玩家放下一件东西 —— 关卡建好之后才出现的散落物，要补一个网格 */
  Renderer.prototype.addLoose = function (l) {
    if (!this.looseMeshes) this.looseMeshes = [];
    this.looseMeshes.push(this._makeLoose(l));
  };

  /* ── 插座 ──────────────────────────────────────────
     **看不见的插座等于没有插座。** 一栋楼三十几个、全校两百多个，
     所以按楼合批成 InstancedMesh，跟着分区加载一起显隐。
     14×8cm 的小白板贴在墙上，离地 0.35m —— 不显眼，但找得到。 */
  Renderer.prototype._buildOutlets = function () {
    const list = this.level.outlets || [];
    if (!list.length) return;
    const byBuilding = new Map();
    for (const o of list) {
      const k = o.buildingId === undefined ? 0 : o.buildingId;
      if (!byBuilding.has(k)) byBuilding.set(k, []);
      byBuilding.get(k).push(o);
    }
    const geo = new THREE.BoxGeometry(0.14, 0.08, 0.03);
    const mat = new THREE.MeshLambertMaterial({ color: 0xE8E4DA });
    const m4 = new THREE.Matrix4();
    this.outletGroups = new Map();
    for (const [bid, arr] of byBuilding) {
      const inst = new THREE.InstancedMesh(geo, mat, arr.length);
      arr.forEach((o, i) => { m4.makeTranslation(o.pos.x, o.pos.y, o.pos.z); inst.setMatrixAt(i, m4); });
      inst.instanceMatrix.needsUpdate = true;
      const group = new THREE.Group();
      group.add(inst);
      // 配电箱：比插座大得多（40×55cm），灰蓝色，一栋楼一个，走廊西端一眼能看见
      for (const p of (this.level.panels || [])) {
        if ((p.buildingId === undefined ? 0 : p.buildingId) !== bid) continue;
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.55, 0.12),
          new THREE.MeshLambertMaterial({ color: 0x8C99A8 }));
        box.position.set(p.pos.x, p.pos.y, p.pos.z);
        group.add(box);
      }
      if (bid !== 0) this.outletGroups.set(bid, group);
      this.scene.add(group);
    }
  };

  /** 背包类容器被整个拎走：实例矩阵缩到 0（重建整批太贵，也没必要） */
  Renderer.prototype.removeContainer = function (box) {
    const slot = this.containerSlots && this.containerSlots.get(box.id);
    if (!slot) return;
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    slot.inst.setMatrixAt(slot.i, z);
    slot.inst.instanceMatrix.needsUpdate = true;
  };

  Renderer.prototype._syncContainers = function () {
    const S = C.Streaming;
    if (this.containerGroups) {
      for (const [bid, group] of this.containerGroups) group.visible = !S || S.isLoaded(bid);
    }
    if (this.outletGroups) {
      for (const [bid, group] of this.outletGroups) group.visible = !S || S.isLoaded(bid);
    }
  };

  Renderer.prototype._buildAvatar = function () {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.3),
      new THREE.MeshLambertMaterial({ color: 0x4c6b8a }));
    body.position.y = 0.72;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.28),
      new THREE.MeshLambertMaterial({ color: 0xc8b49a }));
    head.position.y = 1.45;
    this.avatarHead = head;
    g.add(body, head);
    g.visible = false;
    this.avatar = g;
    this.scene.add(g);
  };

  /* 丧尸：全部合进 3 个 InstancedMesh（身体 / 头 / 朝向片）。
     全校 320 只，一只一个 Group 就是近千次 draw call —— 实测帧率从 60 掉到 13。
     合批之后是 3 次，代价只是每帧写几百个矩阵（可忽略）。 */
  Renderer.prototype._buildZombies = function () {
    const n = Math.max(1, C.ZombieManager.list.length);
    const parts = [
      /* `[实测]` 尺寸下调：肩宽 0.55 → 0.42（成年人肩宽约 0.45），
         总高 1.66 → 1.55m。原尺寸在 2.6m 的走廊里像堵墙，两只并排就把路封死了。 */
      { key: 'body', geo: new THREE.BoxGeometry(0.42, 1.05, 0.28), off: 0.70, color: 0x9a5555 },
      { key: 'head', geo: new THREE.BoxGeometry(0.24, 0.26, 0.24), off: 1.36, color: 0xc8b49a },
      { key: 'nose', geo: new THREE.BoxGeometry(0.10, 0.07, 0.18), off: 1.36, color: 0x222222, z: 0.17 }
    ];
    this.zInst = {};
    for (const p2 of parts) {
      const inst = new THREE.InstancedMesh(p2.geo, new THREE.MeshLambertMaterial({ color: p2.color }), n);
      inst.frustumCulled = false;        // 实例矩阵每帧变，包围盒靠不住
      this.scene.add(inst);
      this.zInst[p2.key] = { mesh: inst, off: p2.off, z: p2.z || 0 };
    }
    // 蜷伏者是另一种颜色：按实例上色，不用再开一批
    const col = new THREE.Color();
    const body = this.zInst.body.mesh;
    C.ZombieManager.list.forEach((z, i) => {
      body.setColorAt(i, col.setHex(z.typeName === 'Crawler' ? 0x6b5a4a : 0x9a5555));
    });
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    this._zTmp = { m: new THREE.Matrix4(), t: new THREE.Matrix4(), q: new THREE.Quaternion(),
                   v: new THREE.Vector3(), s: new THREE.Vector3() };
  };

  /** 每帧把丧尸的位置写进实例矩阵。看不见的（太远 / 已死）缩到 0。 */
  Renderer.prototype._syncZombies = function (player) {
    if (!this.zInst) return;
    const T = this._zTmp;
    const far = C.Config.render.zombieDistance;
    const list = C.ZombieManager.list;
    for (let i = 0; i < list.length; i++) {
      const z = list[i];
      const dx = z.pos.x - player.pos.x, dz = z.pos.z - player.pos.z;
      const show = z.alive && dx * dx + dz * dz <= far * far;
      if (!show) {
        T.m.makeScale(0, 0, 0);
        for (const k in this.zInst) this.zInst[k].mesh.setMatrixAt(i, T.m);
        continue;
      }
      const sy = (z.state === C.ZombieState.Prone) ? 0.35 : 1;
      T.q.setFromAxisAngle(T.v.set(0, 1, 0), z.yaw);
      T.m.compose(T.v.set(z.pos.x, z.pos.y, z.pos.z), T.q, T.s.set(1, sy, 1));
      for (const k in this.zInst) {
        const part = this.zInst[k];
        T.t.makeTranslation(0, part.off, part.z);
        part.mesh.setMatrixAt(i, T.t.premultiply(T.m));
      }
    }
    for (const k in this.zInst) this.zInst[k].mesh.instanceMatrix.needsUpdate = true;
  };

  Renderer.prototype.update = function (player, time, dt) {
    const P = C.Config.player;
    // 相机：眼位 + 探头横向偏移 + 轻微翻滚
    const eye = player.eyePos();
    const lean = player.leanAmount;
    const right = { x: Math.cos(player.yaw), z: -Math.sin(player.yaw) };

    this.avatar.visible = player.wallHug;
    if (player.wallHug) {
      const wn = player.wallNormal;
      /* 背贴墙 → 第三人称。相机不能往身后放（身后就是墙），改为沿墙面切线侧移，
         并挑空间更大的那一侧。 */
      /* 屁股靠墙：身体面朝墙外（背贴墙），并往墙里贴 0.14m 让后背真的挨上；
         头单独转向行进方向，做出「贴着墙侧头看走廊」的姿态。 */
      const bodyYaw = wn ? Math.atan2(-wn.x, -wn.z) : player.yaw;
      this.avatar.position.set(
        player.pos.x - (wn ? wn.x * 0.14 : 0), player.pos.y, player.pos.z - (wn ? wn.z * 0.14 : 0));
      this.avatar.rotation.y = bodyYaw;
      if (this.avatarHead) this.avatarHead.rotation.y = C.M.wrapAngle(player.yaw - bodyYaw);
      const fwd = player.forwardFlat();
      const n = player.wallNormal || fwd;
      // 身后 + 往走廊里推 + 抬高；身后是沿墙方向，不会撞墙
      let back = P.thirdPersonBack;
      const at = (d) => ({ x: eye.x - fwd.x * d + n.x * P.thirdPersonAway,
                           y: eye.y + P.thirdPersonUp,
                           z: eye.z - fwd.z * d + n.z * P.thirdPersonAway });
      if (this.world && !this.world.lineOfSight(eye, at(back))) back = 1.1;   // 背后堵住就拉近
      const cam = at(back);
      this.camera.position.set(cam.x, cam.y, cam.z);
      /* 朝向与第一人称完全一致，只是位置退到身后。
         用 lookAt 盯住身前某一点的话，相机光轴与投掷方向会在那一点之后越岔越开，
         准星就对不上落点了 —— 贴墙投石之所以别扭就是这个原因。 */
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotateY(player.yaw);
      this.camera.rotateX(player.pitch);
      // 准星指向的远点：投掷方向对准它，落点标记才会落在准星上
      const cp = Math.cos(player.pitch), AIM = 20;
      player.aimTarget = {
        x: cam.x - Math.sin(player.yaw) * cp * AIM,
        y: cam.y + Math.sin(player.pitch) * AIM,
        z: cam.z - Math.cos(player.yaw) * cp * AIM
      };
    } else {
      player.aimTarget = null;
      this.camera.position.set(eye.x, eye.y, eye.z);   // eyePos 里已含侧身偏移
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotateY(player.yaw);
      this.camera.rotateX(player.pitch);
      this.camera.rotateZ(-lean * P.leanAngle * Math.PI / 180);
    }

    // 光照随昼夜（主文档 3.1：19:00 后室内没有光源则接近全黑）
    const dl = time.getDaylight();
    this.hemi.intensity = 0.15 + dl * 0.85;
    this.sun.intensity = dl * 0.6;
    this.ambient.intensity = 0.10 + dl * 0.25;   // 下限抬高一点，否则天花板是纯黑的
    this.scene.fog.far = 20 + dl * 45;
    const bg = new THREE.Color().setHSL(0.62, 0.35, 0.03 + dl * 0.16);
    this.scene.background = bg; this.scene.fog.color = bg;

    this.torch.intensity = player.flashlight ? 2.4 : 0;
    if (player.flashlight) {
      const d = player.aimDir();
      this.torch.position.copy(this.camera.position);
      this.torchTarget.position.set(eye.x + d.x * 10, eye.y + d.y * 10, eye.z + d.z * 10);
    }

    this._syncZombies(player);

    // 投掷物
    while (this.stoneMeshes.length < C.Projectiles.list.length) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5),
        new THREE.MeshLambertMaterial({ color: 0xdddddd }));
      this.scene.add(s); this.stoneMeshes.push(s);
    }
    this.stoneMeshes.forEach((m, i) => {
      const p = C.Projectiles.list[i];
      m.visible = !!p;
      if (p) m.position.set(p.pos.x, p.pos.y, p.pos.z);
    });

    for (const l of this.looseMeshes || []) l.mesh.visible = !l.loose.taken;
    this._updateThrowPreview(player);
  };

  Renderer.prototype._updateThrowPreview = function (player) {
    const T = C.Config.throwing;
    const show = player.charge > 0 && player.alive;
    this.arcLine.visible = show;
    this.arcDots.visible = show;
    this.marker.visible = show && T.showLandingMarker;
    this.audibleRing.visible = show && T.showAudibleRing;
    if (!show) return;

    const pred = player.predictThrow();
    /* 出手点挪到右手之后，弧线的头几个点离相机只有几十厘米 ——
       点阵开了 sizeAttenuation，这么近会被放大成糊住半个屏幕的黄方块。
       跳过 NEAR_SKIP 以内的点：那几个点本来就在自己身上，不带任何信息。 */
    const NEAR_SKIP = 1.0;
    const cam = this.camera.position;
    const pts = [];
    for (const p of pred.points) {
      if (pts.length === 0) {
        const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
        if (dx * dx + dy * dy + dz * dz < NEAR_SKIP * NEAR_SKIP) continue;
      }
      pts.push(p);
    }
    const attr = this.arcLine.geometry.attributes.position;
    const n = Math.min(pts.length, attr.count);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      attr.setXYZ(i, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
    this.arcLine.geometry.setDrawRange(0, n);
    this.arcLine.computeLineDistances();          // 虚线必须重算，否则不显示间隔
    const dattr = this.arcDots.geometry.attributes.position;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      dattr.setXYZ(i, p.x, p.y, p.z);
    }
    dattr.needsUpdate = true;
    this.arcDots.geometry.setDrawRange(0, n);

    const im = pred.impact;
    this.marker.position.set(im.x, im.y + 0.02, im.z);
    this.audibleRing.position.set(im.x, im.y + 0.03, im.z);
    this.audibleRing.scale.setScalar(Math.max(0.1, pred.radius));
  };

  Renderer.prototype.resize = function (w, h) {
    this.three.setPixelRatio(Math.min(devicePixelRatio, (C.Touch && C.Touch.enabled) ? 1.25 : 2));
    this.three.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
  Renderer.prototype.render = function () { this.three.render(this.scene, this.camera); };

  C.Renderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
