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
    this.three.setPixelRatio(Math.min(devicePixelRatio, 2));
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
    this.zombieMeshes = new Map();
    this.stoneMeshes = [];
    this._arc = null;
  }

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
    this.camera.position.set(
      eye.x + right.x * lean * P.leanOffset, eye.y - (lean ? 0.12 : 0), eye.z + right.z * lean * P.leanOffset);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(player.yaw + (lean ? -lean * P.peekYaw * 0.35 * Math.PI / 180 : 0));
    this.camera.rotateX(player.pitch);
    this.camera.rotateZ(-lean * P.leanAngle * Math.PI / 180);

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

    // 蓄力时的落点预测弧线
    if (this._arc) { this.scene.remove(this._arc); this._arc.geometry.dispose(); this._arc = null; }
    if (player.charge > 0) {
      const pts = player.predictArc().map(p => new THREE.Vector3(p.x, p.y, p.z));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this._arc = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd479 }));
      this.scene.add(this._arc);
    }
  };

  Renderer.prototype.resize = function (w, h) {
    this.three.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
  Renderer.prototype.render = function () { this.three.render(this.scene, this.camera); };

  C.Renderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
