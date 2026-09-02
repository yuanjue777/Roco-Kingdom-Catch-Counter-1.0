/*
 * 17-touch.js —— 触屏操作层
 * 手机上没有指针锁定，也没有「按住 Shift」这种修饰键，所以这一层做三件事：
 *   1) 左下虚拟摇杆 → 模拟量的 forward/right（键盘是 0/1，这里是 0~1）
 *   2) 空白区拖拽 → 转视角（代替鼠标）
 *   3) 右侧按键面板 → 蹲/跑/屏息/交互/投石/探头
 * 它只产出与键盘同构的 input 结构，玩家控制器完全不知道触屏的存在。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  const Touch = {
    enabled: false,
    game: null,
    look: { dx: 0, dy: 0 },
    stick: { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, radius: 52 },
    looking: { id: -1, lx: 0, ly: 0 },
    btn: {},            // 按住类按钮的当前状态
    toggle: {},         // 开关类按钮的当前状态

    detect() {
      const forced = /[?&]touch=1/.test(location.search);
      const coarse = root.matchMedia && root.matchMedia('(pointer: coarse)').matches;
      return forced || (coarse && ('ontouchstart' in root || navigator.maxTouchPoints > 0));
    },

    init(game) {
      this.game = game;
      this.enabled = this.detect();
      if (!this.enabled) return;
      document.body.classList.add('touch');

      const layer = document.getElementById('touch');
      layer.hidden = false;
      this.layer = layer;
      this.knob = document.getElementById('stickKnob');
      this.base = document.getElementById('stickBase');

      // 按住类：按下为真，抬起为假
      const holds = { btnBreath: 'holdBreath', btnInteract: 'interact', btnThrow: 'throwHeld',
                      btnLeanL: 'leanL', btnLeanR: 'leanR', btnWall: 'wallHug' };
      for (const id in holds) this._bindHold(document.getElementById(id), holds[id]);

      // 开关类：点一下切换
      this._bindToggle(document.getElementById('btnCrouch'), 'crouch');
      this._bindToggle(document.getElementById('btnRun'), 'run');

      // 直接触发按键行为的
      this._bindTap(document.getElementById('btnTorch'), () => { game.player.flashlight = !game.player.flashlight; });
      this._bindTap(document.getElementById('btnWatch'), () => { this.toggle.watch = !this.toggle.watch; });
      this._bindTap(document.getElementById('btnDebug'), () => { game.debug.visible = !game.debug.visible; });
      this._bindTap(document.getElementById('btnTune'), () => { document.getElementById('tuner').classList.toggle('open'); });
      this._bindTap(document.getElementById('btnHelp'), () => {
        const h = document.getElementById('startHint');
        h.style.display = (h.style.display === 'none') ? 'flex' : 'none';
      });

      // 摇杆
      this.base.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const r = this.base.getBoundingClientRect();
        this.stick.active = true; this.stick.id = e.pointerId;
        this.stick.ox = r.left + r.width / 2; this.stick.oy = r.top + r.height / 2;
        this._moveStick(e.clientX, e.clientY);
        this.base.setPointerCapture(e.pointerId);
      });
      this.base.addEventListener('pointermove', (e) => {
        if (!this.stick.active || e.pointerId !== this.stick.id) return;
        this._moveStick(e.clientX, e.clientY);
      });
      const endStick = (e) => {
        if (e.pointerId !== this.stick.id) return;
        this.stick.active = false; this.stick.id = -1; this.stick.x = 0; this.stick.y = 0;
        this.knob.style.transform = 'translate(-50%, -50%)';
      };
      this.base.addEventListener('pointerup', endStick);
      this.base.addEventListener('pointercancel', endStick);

      // 空白区拖拽转视角
      layer.addEventListener('pointerdown', (e) => {
        if (e.target !== layer) return;                 // 点在按钮上时不转视角
        if (!game.player.alive) { game.restart(); return; }
        this.looking.id = e.pointerId; this.looking.lx = e.clientX; this.looking.ly = e.clientY;
        layer.setPointerCapture(e.pointerId);
      });
      layer.addEventListener('pointermove', (e) => {
        if (e.pointerId !== this.looking.id) return;
        this.look.dx += e.clientX - this.looking.lx;
        this.look.dy += e.clientY - this.looking.ly;
        this.looking.lx = e.clientX; this.looking.ly = e.clientY;
      });
      const endLook = (e) => { if (e.pointerId === this.looking.id) this.looking.id = -1; };
      layer.addEventListener('pointerup', endLook);
      layer.addEventListener('pointercancel', endLook);

      // 屏幕方向提示
      const checkOrient = () => {
        document.getElementById('rotateHint').hidden = innerWidth >= innerHeight;
      };
      addEventListener('resize', checkOrient);
      addEventListener('orientationchange', () => setTimeout(checkOrient, 250));
      checkOrient();
    },

    _moveStick(cx, cy) {
      let dx = cx - this.stick.ox, dy = cy - this.stick.oy;
      const len = Math.hypot(dx, dy), R = this.stick.radius;
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      this.stick.x = dx / R; this.stick.y = dy / R;
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    },

    _bindHold(el, key) {
      if (!el) return;
      const on = (e) => { e.preventDefault(); this.btn[key] = true; el.classList.add('on'); el.setPointerCapture(e.pointerId); };
      const off = (e) => { e.preventDefault(); this.btn[key] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    },
    _bindToggle(el, key) {
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.toggle[key] = !this.toggle[key];
        el.classList.toggle('on', !!this.toggle[key]);
      });
    },
    _bindTap(el, fn) {
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); el.classList.add('flash'); });
      el.addEventListener('pointerup', () => el.classList.remove('flash'));
      el.addEventListener('pointercancel', () => el.classList.remove('flash'));
    },

    /** 与键盘同构的 input；由 Game._input 合并 */
    read() {
      const s = this.stick;
      return {
        forward: -s.y, right: s.x,
        run: !!this.toggle.run, crouch: !!this.toggle.crouch,
        wallHug: !!this.btn.wallHug,
        lean: (this.btn.leanR ? 1 : 0) - (this.btn.leanL ? 1 : 0),
        holdBreath: !!this.btn.holdBreath,
        interact: !!this.btn.interact,
        throwHeld: !!this.btn.throwHeld
      };
    },

    /** 取走并清空本帧的视角增量 */
    takeLook() {
      const d = { dx: this.look.dx, dy: this.look.dy };
      this.look.dx = 0; this.look.dy = 0;
      return d;
    },

    /** 蓄力/交互进度反馈到按钮上，手机没有准星提示，这个反馈很必要 */
    sync(player) {
      if (!this.enabled) return;
      const t = document.getElementById('btnThrow');
      if (t) t.style.setProperty('--fill', (player.charge * 100).toFixed(0) + '%');
      const f = document.getElementById('btnInteract');
      if (f) {
        f.style.setProperty('--fill', ((player.interactProgress || 0) * 100).toFixed(0) + '%');
        f.classList.toggle('avail', !!player.interactTarget);
      }
      const b = document.getElementById('btnBreath');
      if (b) b.classList.toggle('avail', player.holdBreath);
    }
  };

  C.Touch = Touch;
})(typeof globalThis !== 'undefined' ? globalThis : this);
