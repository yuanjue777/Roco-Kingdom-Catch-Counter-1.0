/*
 * 16-main.js —— 装配与主循环
 * 这里是唯一允许把各层连起来的地方。任何两个系统之间的直接调用都应该出现在这里，
 * 而不是藏在某个系统内部。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const { M } = C;

  const Game = {
    keys: {}, tapped: {}, mouse: { dx: 0, dy: 0 }, locked: false,
    timeScales: [1, 4, 20], timeScaleIndex: 0,

    start() {
      this.canvas3d = document.getElementById('view');
      this.hudCanvas = document.getElementById('hud');
      this.dbgCanvas = document.getElementById('dbg');
      this.tuner = document.getElementById('tuner');

      this.hud = new C.Hud(this.hudCanvas);
      this.debug = new C.Debug(this.dbgCanvas);
      C.Debug.buildTuner(this.tuner);
      C.Touch.init(this);

      this._bindInput();
      this.restart();
      this._resize();
      addEventListener('resize', () => this._resize());
      this.last = performance.now();
      requestAnimationFrame((t) => this._frame(t));
    },

    restart() {
      C.SoundSystem.reset();
      C.ZombieManager.reset();
      C.ModifierPipeline.clear();
      C.EventBus.clear();

      this.level = C.buildDormitory();
      this.world = new C.World(this.level);
      this.time = new C.TimeSystem();
      // 室外遮挡用碰撞世界的射线检测；声音系统只拿到一个纯函数，不认识 World
      C.SoundSystem.init(this.level.graph, this.time,
        (a, b) => this.world.lineOfSight(a, b));
      C.Projectiles.init(this.world);
      this.player = new C.Player(this.level, this.world);
      C.ZombieManager.spawnAll(this.level, this.world);

      // 渲染器持有场景对象，重开时整体重建
      if (this.renderer) this.renderer.three.dispose();
      this.renderer = new C.Renderer(this.canvas3d, this.level);
      this.renderer.world = this.world;      // 第三人称选边需要射线检测
      this._resize();

      // 音频：把听觉组件的结果接到耳朵上
      const origOnHeard = this.player.hearing.onHeard.bind(this.player.hearing);
      this.player.hearing.onHeard = (info) => { origOnHeard(info); C.Audio.onHeard(info, this.player); };
      C.EventBus.subscribe(C.Events.SoundEmitted, (evt) => {
        if (evt.emitterId === this.player.id) C.Audio.onSelf(evt);
      });
      C.EventBus.subscribe(C.Events.PlayerDied, (e) => { this.player.deathCause = e.cause; });
      this.msg('醒来。宿舍 402。楼里很安静 —— 但这不代表没有东西。');
    },

    msg(text) {
      const el = document.getElementById('toast');
      el.textContent = text; el.style.opacity = '1';
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 5200);
    },

    _bindInput() {
      addEventListener('keydown', (e) => {
        if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
        if (this.keys[e.code]) return;
        this.keys[e.code] = true;
        // 记一笔「本帧内按下过」：快速点击可能整个发生在两帧之间，
        // 只看 keys 会让贴墙、跳跃这类边沿触发的键被吃掉
        this.tapped[e.code] = true;
        switch (e.code) {
          case 'Tab': this.debug.visible = !this.debug.visible; break;
          case 'KeyP': this.tuner.classList.toggle('open'); break;
          case 'KeyL': this.player.flashlight = !this.player.flashlight; break;
          case 'KeyR': if (!this.player.alive) this.restart(); break;
          case 'BracketLeft': this.debug.floor = Math.max(0, this.debug.floor - 1); this.debug.followPlayer = false; break;
          case 'BracketRight': this.debug.floor = Math.min(this.level.bounds.floors - 1, this.debug.floor + 1); this.debug.followPlayer = false; break;
          case 'Backslash': this.debug.followPlayer = !this.debug.followPlayer; break;
          case 'KeyT':
            this.timeScaleIndex = (this.timeScaleIndex + 1) % this.timeScales.length;
            this.time.timeScale = this.timeScales[this.timeScaleIndex];
            this.msg('时间流速 ×' + this.time.timeScale);
            break;
          case 'KeyN':
            this.time.hour = (this.time.hour > 6 && this.time.hour < 19) ? 23 : 12;
            this.msg(this.time.isNight() ? '切到夜间：声音传播距离 +43%，丧尸视觉半径减半' : '切到白天');
            break;
        }
      });
      addEventListener('keyup', (e) => { this.keys[e.code] = false; });

      // 监听在 document 上：开场提示层盖在画布之上，挂在画布上的点击永远收不到
      document.addEventListener('click', () => {
        C.Audio.init(); C.Audio.resume();
        if (C.Touch.enabled) {
          // 手机没有指针锁定，点一下就是开始
          document.getElementById('startHint').style.display = 'none';
          return;
        }
        if (!this.locked) this.canvas3d.requestPointerLock();
      });
      document.addEventListener('pointerlockchange', () => {
        this.locked = document.pointerLockElement === this.canvas3d;
        document.getElementById('startHint').style.display = this.locked ? 'none' : 'flex';
      });
      addEventListener('mousemove', (e) => {
        if (!this.locked) return;
        this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
      });
      // 按住鼠标右键 = 屏息（Space 让给了跳跃）
      this.rmb = false;
      addEventListener('mousedown', (e) => { if (e.button === 2) this.rmb = true; });
      addEventListener('mouseup', (e) => { if (e.button === 2) this.rmb = false; });
      addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
      addEventListener('blur', () => { this.rmb = false; this.keys = {}; this.tapped = {}; });
    },

    _input() {
      const k = this.keys;
      const kb = {
        forward: (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0),
        right: (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0),
        run: !!(k.ShiftLeft || k.ShiftRight),
        crouch: !!(k.ControlLeft || k.ControlRight || k.KeyC),
        wallHug: !!k.KeyV || !!this.tapped.KeyV,
        lean: (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0),
        holdBreath: !!k.KeyZ || this.rmb,     // 按住鼠标右键或 Z：Space 让给跳跃
        interact: !!k.KeyF,
        throwHeld: !!k.KeyG,
        jump: !!k.Space || !!this.tapped.Space
      };
      if (!C.Touch.enabled) return kb;
      // 触屏与键盘取并集：外接键盘的平板两种都能用
      const t = C.Touch.read();
      return {
        forward: Math.abs(t.forward) > 0.02 ? t.forward : kb.forward,
        right: Math.abs(t.right) > 0.02 ? t.right : kb.right,
        run: kb.run || t.run,
        crouch: kb.crouch || t.crouch,
        wallHug: kb.wallHug || t.wallHug,
        lean: kb.lean || t.lean,
        holdBreath: kb.holdBreath || t.holdBreath,
        interact: kb.interact || t.interact,
        throwHeld: kb.throwHeld || t.throwHeld,
        jump: kb.jump || t.jump
      };
    },

    _frame(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;

      // 视角
      if (this.locked) {
        const sens = 0.0022;
        this.player.yaw -= this.mouse.dx * sens;
        this.player.pitch = M.clamp(this.player.pitch - this.mouse.dy * sens, -1.4, 1.4);
      }
      this.mouse.dx = 0; this.mouse.dy = 0;
      if (C.Touch.enabled) {
        const d = C.Touch.takeLook();
        const ts = 0.0042;                       // 触屏灵敏度：手指行程比鼠标短，需要更高
        this.player.yaw -= d.dx * ts;
        this.player.pitch = M.clamp(this.player.pitch - d.dy * ts, -1.4, 1.4);
      }
      this.hud.showWatch = !!this.keys.KeyX || !!C.Touch.toggle.watch;

      this.time.update(dt);
      this.player.update(dt, this._input(), this.time);
      C.Projectiles.update(dt);
      C.ZombieManager.update(dt, this.player, this.time);
      C.SoundSystem.tickStats(dt);

      this.renderer.update(this.player, this.time, dt);
      this.renderer.render();
      this.hud.draw(this.player, this.time, dt, this.renderer.camera);
      this.debug.draw(this.level, this.player, this.time);
      this.dbgCanvas.style.display = this.debug.visible ? 'block' : 'none';
      C.Touch.sync(this.player);
      this.tapped = {};

      requestAnimationFrame((t) => this._frame(t));
    },

    _resize() {
      // 手机上把渲染分辨率压到 1.25 倍：这套灰盒是四层楼几百个盒子，
      // 中端手机按 3x DPR 渲染会掉到 20fps 以下，潜行手感全毁。
      const w = innerWidth, h = innerHeight;
      const dpr = Math.min(devicePixelRatio, C.Touch.enabled ? 1.25 : 2);
      this.renderer.resize(w, h);
      for (const c of [this.hudCanvas, this.dbgCanvas]) {
        c.width = w * dpr; c.height = h * dpr;
        c.style.width = w + 'px'; c.style.height = h + 'px';
        c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      this.hudCanvas.width = w; this.hudCanvas.height = h;
      this.hudCanvas.getContext('2d').setTransform(1, 0, 0, 1, 0, 0);
      this.dbgCanvas.width = w; this.dbgCanvas.height = h;
      this.dbgCanvas.getContext('2d').setTransform(1, 0, 0, 1, 0, 0);
    }
  };

  C.Game = Game;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Game.start());
    else Game.start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
