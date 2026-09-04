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
      C.InventoryUI.init(this);

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
      C.placeContainers(this.level);
      C.placeLooseItems(this.level);
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
      C.EventBus.subscribe('ContainerOpenedEvent', (e) => {
        C.InventoryUI.container = e.box; C.InventoryUI.open = true;
        C.InventoryUI.el.classList.add('open'); C.InventoryUI.render();
      });
      C.EventBus.subscribe('PickupEvent', (e) => this.msg(e.msg));
      C.EventBus.subscribe(C.Events.PlayerDied, (e) => { this.player.deathCause = e.cause; C.Save.clear(); });
      // 睡眠中被响度惊醒（主文档 3.4：margin > 15）
      this.player.hearing.onHeard = ((prev) => (info) => {
        prev(info);
        if (C.Sleep.active && info.margin > C.Config.sleep.interruptMargin) {
          C.Sleep.interrupt(this.time, '被' + (info.evt.label || '声音') + '惊醒');
          this.msg(C.Sleep.wokeReason + '，没能睡好');
        }
      })(this.player.hearing.onHeard);
      C.Sleep.reset();
      const saved = C.Save.read();
      if (saved && saved.incompatible) this.msg('存档版本不兼容（v' + saved.version + '），已忽略。');
      else if (saved && C.Save.apply(this, saved)) this.msg('读取存档：第 ' + this.time.day + ' 天 ' + this.time.format());
      else this.msg('醒来。宿舍 402。楼里很安静 —— 但这不代表没有东西。');
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
          case 'KeyK': this._toggleSleep(); break;
          case 'KeyB': C.InventoryUI.toggle(); break;
          case 'Escape': C.InventoryUI.close(); break;
          case 'F5': { const r = C.Save.save(this); this.msg(r.ok ? '已保存' : '保存失败：' + r.msg); break; }
          case 'Digit1': case 'Digit2': case 'Digit3':
          case 'Digit4': case 'Digit5': case 'Digit6':
            this._useHotbar(+e.code.slice(5) - 1); break;
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

    _useHotbar(i) {
      const it = this.player.hotbar[i];
      if (!it) { this.msg('快取栏 ' + (i + 1) + ' 是空的'); return; }
      this.msg(this.player.useItem(it).msg);
      C.InventoryUI.render();
    },

    _toggleSleep() {
      if (C.Sleep.active) { C.Sleep.interrupt(this.time, '主动醒来'); this.msg('起床'); return; }
      const r = C.Sleep.check(this.player, this.level, C.ZombieManager.list);
      if (!r.ok) { this.msg('睡不了：' + r.reasons.join('、')); return; }
      C.Sleep.begin(this.player, this.time, C.Config.sleep.defaultHours);
      this.msg('入睡…');
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

      const prevHour = this.time.totalGameSeconds;
      this.time.update(dt);
      const dtHours = (this.time.totalGameSeconds - prevHour) / 3600;
      this.player.needs.update(dtHours, C.Sleep.active);
      if (this.player.needs.dead) this.player.die(this.player.needs.cause);

      if (C.Sleep.active) {
        if (C.Sleep.update(dtHours, this.time) === 'done') {
          if (C.Sleep.grantsRested()) { this.player.needs.grantRested(); this.msg('睡了个好觉：精力充沛（24 小时内困乏 −25%、体力回复 +15%）'); }
          else this.msg('醒来。第 ' + this.time.day + ' 天 ' + this.time.format());
        }
        C.ZombieManager.update(dt, this.player, this.time);
        C.SoundSystem.tickStats(dt);
        this.renderer.update(this.player, this.time, dt);
        this.renderer.render();
        this.hud.draw(this.player, this.time, dt, this.renderer.camera);
        requestAnimationFrame((t) => this._frame(t));
        return;
      }
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
      C.InventoryUI.tickSearch(dt);
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
