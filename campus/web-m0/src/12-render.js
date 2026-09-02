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
    this.scene.fog = new THREE.Fog(0x11131a, 12, 60);
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
    this._buildDoors();
    this._buildThrowPreview();
    this._buildAvatar();
    this.zombieMeshes = new Map();
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

  Renderer.prototype._buildStatic = function () {
    const byTag = new Map();
    for (const s of this.level.solids) {
      if (!byTag.has(s.tag)) byTag.set(s.tag, []);
      byTag.get(s.tag).push(s.box);
    }
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4();
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
      this.scene.add(inst);
    }
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
      this.scene.add(mesh);
      this.doorMeshes.push(mesh);
    }
    this._syncDoors();
    C.EventBus.subscribe(C.Events.PortalStateChanged, () => this._syncDoors());
  };

  Renderer.prototype._syncDoors = function () {
    const g = this.level.graph;
    for (const m of this.doorMeshes) {
      const p = g.getPortal(m.userData.portalId);
      m.visible = !g.isPassable(p);
    }
  };

  /* 第三人称才看得见的玩家身体 */
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

  Renderer.prototype._zombieMesh = function (z) {
    let m = this.zombieMeshes.get(z.id);
    if (!m) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.15, 0.35),
        new THREE.MeshLambertMaterial({ color: z.typeName === 'Crawler' ? 0x6b5a4a : 0x9a5555 }));
      body.position.y = 0.75;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3),
        new THREE.MeshLambertMaterial({ color: 0xc8b49a }));
      head.position.y = 1.5;
      // 朝向指示：眼睛方向的小片，方便玩家判断它面朝哪边
      const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.22),
        new THREE.MeshBasicMaterial({ color: 0x222222 }));
      nose.position.set(0, 1.5, 0.22);
      group.add(body, head, nose);
      this.scene.add(group);
      m = group;
      this.zombieMeshes.set(z.id, m);
    }
    return m;
  };

  Renderer.prototype.update = function (player, time, dt) {
    const P = C.Config.player;
    // 相机：眼位 + 探头横向偏移 + 轻微翻滚
    const eye = player.eyePos();
    const lean = player.lean;
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
      this.camera.rotateY(player.yaw + (lean ? -lean * P.peekYaw * 0.35 * Math.PI / 180 : 0));
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

    for (const z of C.ZombieManager.list) {
      const m = this._zombieMesh(z);
      m.visible = z.alive;
      m.position.set(z.pos.x, z.pos.y, z.pos.z);
      m.rotation.y = z.yaw;
      m.scale.y = (z.state === C.ZombieState.Prone) ? 0.35 : 1;
    }

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
    const attr = this.arcLine.geometry.attributes.position;
    const n = Math.min(pred.points.length, attr.count);
    for (let i = 0; i < n; i++) {
      const p = pred.points[i];
      attr.setXYZ(i, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
    this.arcLine.geometry.setDrawRange(0, n);
    this.arcLine.computeLineDistances();          // 虚线必须重算，否则不显示间隔
    const dattr = this.arcDots.geometry.attributes.position;
    for (let i = 0; i < n; i++) {
      const p = pred.points[i];
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
