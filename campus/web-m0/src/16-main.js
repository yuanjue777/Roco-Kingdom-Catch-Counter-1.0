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

      /* ── 开局先选人 ────────────────────────────────
         **选角色发生在建关卡之前**，因为出生点、开局物品、
         甚至宿舍楼要不要铺教学分层，全都由角色决定（角色规格 1.1）。
         `?char=guard` 跳过选择直接开某个角色，调试用；
         `?nopick` 保持老行为（学生 + 零特性）。 */
      const q = typeof location !== 'undefined' ? location.search : '';
      const forced = /[?&]char=([a-z]+)/i.exec(q);
      if (forced || /[?&]nopick\b/.test(q)) {
        C.Loadout.reset().selectCharacter(forced ? forced[1] : 'student');
        this.restart();
      } else {
        C.LoadoutUI.init(() => { this.restart(); this._resize(); this._syncStartHint(); });
        C.LoadoutUI.show();
        this._pickPending = true;
        document.getElementById('startHint').style.display = 'none';
      }
      this._resize();
      addEventListener('resize', () => this._resize());
      addEventListener('orientationchange', () => setTimeout(() => this._resize(), 300));
      // 手机地址栏收起/展开时 innerHeight 会跳变，visualViewport 才是真正可见的那一块
      if (root.visualViewport) root.visualViewport.addEventListener('resize', () => this._resize());
      this.last = performance.now();
      requestAnimationFrame((t) => this._frame(t));
    },

    restart() {
      C.SoundSystem.reset();
      C.ZombieManager.reset();
      C.ModifierPipeline.clear();
      C.EventBus.clear();
      this._pickPending = false;
      /* **管线刚被清空，角色和特性必须紧接着挂回去。**
         顺序反了的话这一局所有特性都是哑的，而且不会报任何错。 */
      if (!C.Loadout.characterId) C.Loadout.selectCharacter('student');
      C.Loadout.applied = false;
      C.Loadout.apply();

      /* 建哪张图：默认全校（M2）。?map=dorm 回到 M0/M1 的单栋宿舍楼 ——
         调声音数值时只想要一栋楼，全校 320 只丧尸的噪声会盖住要看的东西。 */
      const dormOnly = typeof location !== 'undefined' && /[?&]map=dorm\b/.test(location.search);
      this.level = dormOnly ? C.buildDormitory()
        : C.buildCampus({ spawn: C.Loadout.spawn(), tutorial: C.Loadout.tutorialSupported() });
      if (this.level.isCampus) {
        C.placeCampusContainers(this.level);
        C.placeCampusLooseItems(this.level);
      } else {
        C.placeContainers(this.level);
        C.placeLooseItems(this.level);
      }
      C.Streaming.reset(this.level);
      C.Notebook.reset();
      C.Power.reset(this.level);
      C.Cooking.reset();
      C.Outlets.reset();
      C.Placement.reset(); C.Placement.game = this;
      /* **教学只支持「睡过头的学生」**（角色规格 5.2 风险四）。
         教学流程完全绑定宿舍楼 —— 让保安在正门口听「配电间在一楼」是荒谬的。
         不给另外五个角色各做一套教学：那是五倍工作量换微小收益。 */
      C.Tutorial.reset(C.Loadout.tutorialSupported() &&
        !/[?&]skiptut\b/.test(typeof location !== 'undefined' ? location.search : ''));
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
      // 分区加载：规则层只算「哪些楼该在」，渲染层负责切可见性
      C.Streaming.onChange = (loaded) => this.renderer.setLoadedBuildings(loaded);
      C.Streaming.update(this.player.pos);
      this.renderer.setLoadedBuildings(C.Streaming.loaded);
      if (!this._noteReady) {
        C.NotebookUI.init(this); C.LootUI.init(this);
        C.KitchenUI.init(this); C.TutorialUI.init(this);
        C.HotbarUI.init(this); C.PanelUI.init(this);
        C.DeviceUI.init(this); C.PlaceUI.init(this);
        this._noteReady = true;
      }
      C.PanelUI.game = this; C.PanelUI.close();
      C.DeviceUI.game = this; C.DeviceUI.close();
      C.PlaceUI.game = this;
      C.HotbarUI.game = this; C.HotbarUI.render(true);
      C.KitchenUI.game = this; C.KitchenUI.close();
      C.TutorialUI.game = this;
      document.getElementById('tut').style.display = '';
      C.LootUI.game = this;
      C.LootUI.close();
      C.NotebookUI.game = this;
      C.NotebookUI.close();
      this._resize();

      // 音频：把听觉组件的结果接到耳朵上
      const origOnHeard = this.player.hearing.onHeard.bind(this.player.hearing);
      this.player.hearing.onHeard = (info) => { origOnHeard(info); C.Audio.onHeard(info, this.player); };
      C.EventBus.subscribe(C.Events.SoundEmitted, (evt) => {
        if (evt.emitterId === this.player.id) C.Audio.onSelf(evt);
      });
      /* 翻找走轻量的搜刮界面（28-loot-ui），不是全屏背包总览 ——
         翻找时游戏不暂停，玩家必须还能看见身后的走廊 */
      // 摆出来 / 收起来 → 渲染层跟着加/删一个盒子
      C.EventBus.subscribe('ItemPlacedEvent', (e) => this.renderer.addPlaced(e.placed));
      C.EventBus.subscribe('ItemUnplacedEvent', (e) => this.renderer.removePlaced(e.placed));
      C.EventBus.subscribe('ContainerOpenedEvent', (e) => C.LootUI.toggle(e.box));
      C.EventBus.subscribe('ContainerClosedEvent', () => C.LootUI.close());
      /* 跳闸/停电会**报废正在做的东西** —— 电力层只管断电，
         报废是烹饪层的事，在这里把两层接起来（谁也不认识谁）。 */
      C.EventBus.subscribe('CircuitOverloadedEvent', (e) => {
        const link = C.Power.links.find(l => l.id === e.linkId);
        const n = link ? C.Cooking.ruinAllOn(link, 'trip') : 0;
        this.msg('跳闸了' + (n ? '，锅里的东西废了' : ''));
        C.Tutorial.hint('T21', this.time.totalGameSeconds);
      });
      C.EventBus.subscribe('PowerLostEvent', (e) => {
        for (const l of C.Power.links) C.Cooking.ruinAllOn(l, e.reason);
        if (e.reason === 'gridFail') this.msg('第 ' + e.day + ' 天 00:00 —— 市电断了。这次不会再来了。');
        else if (e.reason === 'noFuel') this.msg('发电机没油了');
        else if (e.reason === 'batteryFlat') this.msg('电瓶空了');
      });
      C.EventBus.subscribe('CookingCompletedEvent', () => C.KitchenUI.render());
      C.EventBus.subscribe('FoodCookedEvent', (e) => {
        const f = e.food;
        this.player.needs.hunger = M.clamp(this.player.needs.hunger - f.satiety, 0, C.Config.needs.barLength);
        this.player.needs.thirst = M.clamp(this.player.needs.thirst + f.thirst, 0, C.Config.needs.barLength);
        this.msg('吃了' + f.name + '　饿 −' + f.satiety.toFixed(0) +
                 (f.thirst < 0 ? '　渴 ' + f.thirst.toFixed(0) : ''));
        if (f.recipeId === 'boilWater') C.Tutorial.hint('T22', this.time.totalGameSeconds);
      });
      C.EventBus.subscribe('ContainerOpenedEvent', (e) => C.Notebook.lootContainer(e.box, this.time));
      C.EventBus.subscribe('BagGrabbedEvent', (e) => {
        C.Notebook.lootContainer(e.box, this.time);
        if (e.box.taken) this.renderer.removeContainer(e.box);   // 连包带东西一起拎走了
        C.InventoryUI.render();
      });
      C.EventBus.subscribe('PickupEvent', (e) => this.msg(e.msg));
      C.EventBus.subscribe('RunnersAppearedEvent', (e) => {
        this.msg('第 ' + e.day + ' 天：有东西跑起来了。');
        C.Notebook.note('runner:appear', '第 ' + e.day + ' 天起，出现了会跑的（' + e.count + ' 只）', this.time);
      });
      C.EventBus.subscribe(C.Events.PlayerDied, (e) => { this.player.deathCause = e.cause; C.Save.clear(); });
      // 睡眠中被响度惊醒（主文档 3.4：margin > 15）；顺便把「听见丧尸」记进笔记本
      this.player.hearing.onHeard = ((prev) => (info) => {
        prev(info);
        const src = info.evt && C.ZombieManager.list.find(q => q.id === info.evt.emitterId);
        if (src) C.Notebook.observeZombie(src, '听见', this.time);
        const wake = C.ModifierPipeline.query('sleep.interrupt_threshold', C.Config.sleep.interruptMargin, 0);
        if (C.Sleep.active && info.margin > wake) {
          C.Sleep.interrupt(this.time, '被' + (info.evt.label || '声音') + '惊醒');
          this.msg(C.Sleep.wokeReason + '，没能睡好');
        }
      })(this.player.hearing.onHeard);
      C.Sleep.reset();
      this._describeLevel();
      const saved = C.Save.read();
      if (saved && saved.incompatible) this.msg('存档版本不兼容（v' + saved.version + '），已忽略。');
      else if (saved && C.Save.apply(this, saved)) this.msg('读取存档：第 ' + this.time.day + ' 天 ' + this.time.format());
      else this.msg('醒来。宿舍 402。楼里很安静 —— 但这不代表没有东西。');
    },

    /* 开场卡片那一行规格由实际建出来的关卡填 —— 手写的话改了地图必忘改文案 */
    _describeLevel() {
      const lv = this.level;
      const spec = document.getElementById('startSpec');
      const stage = document.getElementById('startStage');
      if (!spec) return;
      if (lv.isCampus) {
        const floors = lv.buildings.reduce((n, b) => n + b.spec.floors, 0);
        spec.textContent = `CAMPUS GREYBOX / ${lv.buildings.length} BUILDINGS · ${floors} FLOORS / `
          + `${lv.zones.length} OUTDOOR ZONES / ${C.ZombieManager.list.length} ZOMBIES / `
          + `${(lv.containers || []).length} CONTAINERS`;
        if (stage) stage.textContent = 'M2 · 全校灰盒';
      } else {
        spec.textContent = `DORMITORY GREYBOX / ${lv.bounds.floors}F × ${lv.floorsMeta[0].rooms.length} ROOMS / `
          + `${C.ZombieManager.list.length} ZOMBIES / ${(lv.containers || []).length} CONTAINERS`;
        if (stage) stage.textContent = 'M0 · 潜行手感验证';
      }
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
        C.TutorialUI.anyKey();                 // 一次性说明：按任意键关掉
        if (e.code === 'Tab') C.TutorialUI.recall();   // 长按 Tab 调回当前目标
        switch (e.code) {
          case 'Tab': this.debug.visible = !this.debug.visible; break;
          case 'KeyP': this.tuner.classList.toggle('open'); break;
          case 'KeyF':
            /* 搜刮界面开着时，F 无论朝哪儿看都能关掉它 ——
               交互键要求「瞄着容器」，但界面开着的时候玩家很可能已经转头看走廊了。
               关掉之后要把这一次 F 吃掉，否则同一帧的交互判定会立刻把它再打开。 */
            if (C.LootUI.open) { C.LootUI.close(); this._eatF = true; }
            break;
          // 探索用开关（正式版要砍掉）：无敌 / 隐身
          case 'KeyO': this.toggleCheat('godMode', '无敌'); break;
          case 'KeyI': this.toggleCheat('ghost', '隐身'); break;
          case 'KeyK': C.KitchenUI.toggle(); break;
          case 'KeyJ': C.NotebookUI.toggle(); break;
          case 'KeyR':
            // 拖动中按 R 转 90°；没在拖就是原来的重开
            if (C.LootUI.rotate()) { C.LootUI.render(); break; }
            if (!this.player.alive) this.restart();
            break;
          case 'Escape':
            /* `[实测]` 这个 switch 里原来有**两条 `case 'Escape'`** ——
               第二条永远执行不到（JS 的 switch 取第一条匹配）。合成一条。
               顺序有讲究：**先取消正在进行的动作，再关面板** ——
               正在放置时按 Esc，玩家要的是「别放了」，不是「关背包」。 */
            if (C.Placement.ghost) { C.Placement.cancel(); this.msg('取消放置'); break; }
            if (C.Placement.cable) { C.Placement.dropCable(); this.msg('放下了电线'); break; }
            C.DeviceUI.close(); C.PanelUI.close();
            C.NotebookUI.close(); C.LootUI.close(); C.InventoryUI.close();
            break;
          case 'KeyL': this.player.flashlight = !this.player.flashlight; break;
          case 'BracketLeft': this.debug.floor = Math.max(0, this.debug.floor - 1); this.debug.followPlayer = false; break;
          case 'BracketRight': this.debug.floor = Math.min(this.level.bounds.floors - 1, this.debug.floor + 1); this.debug.followPlayer = false; break;
          case 'Backslash': this.debug.followPlayer = !this.debug.followPlayer; break;
          case 'KeyT':
            this.timeScaleIndex = (this.timeScaleIndex + 1) % this.timeScales.length;
            this.time.timeScale = this.timeScales[this.timeScaleIndex];
            this.msg('时间流速 ×' + this.time.timeScale);
            break;
          case 'KeyU': this._toggleSleep(); break;   // 睡觉（K 让给厨房）
          case 'KeyB': C.InventoryUI.toggle(); break;
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
      addEventListener('keyup', (e) => { this.keys[e.code] = false; if (e.code === 'KeyF') this._eatF = false; });

      /* 转视角有两种模式：
           lock —— 指针锁定，鼠标随便动（正常情况）
           drag —— 按住左键拖动（**指针锁定被禁用时的退路**）
         退路是必需的：这个页面经常被嵌在 sandbox 的 iframe 里
         （artifact / itch.io / 各种嵌入），少了 allow-pointer-lock
         权限时 requestPointerLock 会被直接拒绝，控制台只留一行
         「Blocked pointer lock … the element's frame is sandboxed」。
         以前把「开始游戏」挂在 pointerlockchange 上，于是**点了没反应，游戏根本进不去**。
         现在点击立刻开始，锁不上就换成拖动。 */
      this.lookMode = 'lock';
      this.started = false;

      const start = () => {
        if (this.started) return;
        this.started = true;
        this._syncStartHint();
      };
      this._startPlay = start;

      // 监听在 document 上：开场提示层盖在画布之上，挂在画布上的点击永远收不到
      document.addEventListener('click', (e) => {
        C.Audio.init(); C.Audio.resume();
        // 背包 / 笔记本开着的时候，点击是在用界面，不能顺手把指针锁回去 ——
        // 锁上之后鼠标就没了，地图上的标记再也点不中
        if (e.target && e.target.closest &&
            e.target.closest('#inv, #note, #tuner, #loot, #pick, #kitchen, #panel, #device, #invMenu')) return;
        // 面板开着时点空白处也不能锁 —— 一锁鼠标就没了，格子拖不动
        if (this._panelOpen()) return;
        // 放置模式下这一次点击是「放下」，mousedown 已经处理过了
        if (C.Placement.ghost) return;
        if (C.Touch.enabled) {
          // 手机没有指针锁定，点一下就是开始。顺手进全屏 ——
          // 地址栏一收起来，「转视角把窗口拖下来」这件事就从根上没有了。
          start();
          C.Touch.autoFullscreenOnce();
          return;
        }
        start();                                  // 先开始，再谈锁不锁得上
        if (this.lookMode !== 'lock' || this.locked) return;
        const p2 = this.canvas3d.requestPointerLock();
        // 新版浏览器返回 Promise，旧版不返回；两条路都要接住失败
        if (p2 && p2.catch) p2.catch(() => this._fallbackToDrag());
      });
      document.addEventListener('pointerlockerror', () => this._fallbackToDrag());
      document.addEventListener('pointerlockchange', () => {
        this.locked = document.pointerLockElement === this.canvas3d;
        this._syncStartHint();
      });

      this.drag = { on: false, x: 0, y: 0 };
      addEventListener('mousemove', (e) => {
        if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; return; }
        /* **面板开着的时候视角必须完全不动。**
           `[实测]` 指针锁定模式早就处理好了（开面板就 exitPointerLock），
           但**拖动模式**（sandbox 的 iframe 里锁不上指针，只能拖）没管：
           在搜刮界面上拖一个格子，视角跟着转了半圈。
           拖动模式下没有「锁」可以退，所以只能在这里直接把拖拽掐掉。 */
        if (this._panelOpen()) { this.drag.on = false; return; }
        if (this.lookMode !== 'drag' || !this.drag.on) return;
        this.mouse.dx += e.clientX - this.drag.x;
        this.mouse.dy += e.clientY - this.drag.y;
        this.drag.x = e.clientX; this.drag.y = e.clientY;
      });
      // 按住鼠标右键 = 屏息（Space 让给了跳跃）
      this.rmb = false;
      addEventListener('mousedown', (e) => {
        if (e.button === 2) this.rmb = true;
        /* 放置模式下左键 = 放下。**要在指针锁定那段逻辑之前拦掉** ——
           否则第一次点击会被当成「点击画面开始」，东西放不下去。 */
        if (e.button === 0 && C.Placement.ghost && !this._panelOpen()) {
          const r = C.Placement.confirm(this.player);
          this.msg(r.msg);
          if (r.ok) C.EventBus.publish('DeviceOpenedEvent', { placed: r.placed });
          e.preventDefault();
          return;
        }
        // 拖动模式：左键按下即开始拖视角（面板上的拖动不算）
        // 面板名单要和 `_panelOpen()` 对得上，漏一个就是「在这个界面上能转视角」
        if (e.button === 0 && this.lookMode === 'drag' && !C.Touch.enabled && !this._panelOpen() &&
            !(e.target && e.target.closest &&
              e.target.closest('#inv, #note, #tuner, #loot, #kitchen, #pick, #hotbar, #panel, #device'))) {
          this.drag.on = true; this.drag.x = e.clientX; this.drag.y = e.clientY;
          e.preventDefault();
        }
      });
      addEventListener('mouseup', (e) => {
        if (e.button === 2) this.rmb = false;
        if (e.button === 0) this.drag.on = false;
      });
      /* 右键 = 屏息。指针锁定时浏览器本来就不弹菜单，但**拖动模式下会弹** ——
         一弹菜单，按住右键的屏息就断了，玩家会以为屏息没用。
         所以只要游戏已经开始就吃掉这个事件。 */
      addEventListener('contextmenu', (e) => { if (this.started || this.locked) e.preventDefault(); });
      addEventListener('blur', () => {
        this.rmb = false; this.drag.on = false; this.keys = {}; this.tapped = {};
      });
    },

    /** 探索用开关。**正式版必须砍掉或锁进开发者构建。** */
    toggleCheat(key, label) {
      const on = !C.Config.debug[key];
      C.Config.debug[key] = on;
      if (on && key === 'godMode' && !this.player.alive) this.restart();
      this.msg(label + (on ? '：开' : '：关') +
        (on && key === 'ghost' ? '　（丧尸看不见你，但**听得见**你的脚步）' : ''));
      const btn = document.getElementById(key === 'godMode' ? 'btnGod' : 'btnGhost');
      if (btn) btn.classList.toggle('on', on);
    },

    /** 有没有面板开着（背包 / 笔记本 / 搜刮）。这些面板都会主动解除指针锁定。 */
    _panelOpen() {
      return C.LootUI.open || C.NotebookUI.open || C.InventoryUI.open || C.KitchenUI.open ||
             (C.PanelUI && C.PanelUI.open) || (C.DeviceUI && C.DeviceUI.open) ||
             (C.LoadoutUI && C.LoadoutUI.open);
    },

    /* 面板借走鼠标 / 还回鼠标。
       `[实测]` **只有面板开着的那一会儿才该解锁**，其余时间照常锁定。
       面板关掉之后如果不主动锁回去，玩家得再点一下画面才能转视角 ——
       而那一下点击还会把「点击画面开始」那层顺带招回来，像是游戏断了一下。
       关闭动作本身（按 F、按 Esc、点「关闭」）都带用户手势，所以锁得回去。 */
    releaseMouseForPanel() {
      if (this.lookMode !== 'lock') return;          // 拖动模式本来就没锁
      if (this.locked) this._relockAfterPanel = true;
      if (document.pointerLockElement) document.exitPointerLock();
    },
    restoreMouseAfterPanel() {
      if (this.lookMode !== 'lock' || !this._relockAfterPanel || this._panelOpen()) {
        this._syncStartHint();
        return;
      }
      this._relockAfterPanel = false;
      const p = this.canvas3d.requestPointerLock();
      if (p && p.catch) p.catch(() => this._syncStartHint());
      this._syncStartHint();
    },

    /* 开场层什么时候该回来。
       `[实测]` 只判断「没锁上」是不够的：背包/笔记本/搜刮界面**主动解除了指针锁定**，
       于是一开面板，「点击画面开始」就糊在面板背后弹出来。
       正确条件是：还没开始过，或者玩家自己按 Esc 放开了鼠标且没有任何面板开着。 */
    _syncStartHint() {
      const hint = document.getElementById('startHint');
      if (!hint) return;
      // 选角色界面开着时，「点击画面开始」不能糊在它上面
      const show = (!this._pickPending && !(C.LoadoutUI && C.LoadoutUI.open)) &&
        (!this.started || (this.lookMode === 'lock' && !this.locked && !this._panelOpen()));
      hint.style.display = show ? 'flex' : 'none';
    },

    /** 指针锁定用不了（多半是被 sandbox 的 iframe 挡了）：换成按住左键拖动 */
    _fallbackToDrag() {
      if (this.lookMode === 'drag') return;
      this.lookMode = 'drag';
      this.locked = false;
      document.getElementById('startHint').style.display = 'none';
      document.body.classList.add('dragLook');
      this.msg('这个页面不允许锁定鼠标 —— 改为「按住左键拖动」转视角，其余按键照常');
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
        interact: !!k.KeyF && !this._eatF,
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
        interact: (kb.interact || t.interact) && !this._eatF,
        throwHeld: kb.throwHeld || t.throwHeld,
        jump: kb.jump || t.jump
      };
    },

    _frame(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      /* 还在选角色 —— 世界都还没建。**空转，但循环要继续跑**，
         否则选完之后没有人再叫 requestAnimationFrame，画面永远是黑的。 */
      if (this._pickPending || !this.renderer) { requestAnimationFrame((t) => this._frame(t)); return; }

      /* ── 视角 ────────────────────────────────────────
         **面板开着就一律不转视角，攒下的位移直接丢掉。**

         `[实测]` 这条判断必须放在这里，而不是散在各个事件处理里。
         之前有三条路都能让视角在搜刮界面开着时转起来：
           ① 拖动模式的 mousedown 没把 `#loot` 排除掉；
           ② 指针锁定退出是异步的（`pointerlockchange`），
              退出前这一两帧的 `movementX` 已经攒进 `mouse.dx` 了；
           ③ 触屏的摇杆层同样不认识面板。
         堵三个入口不如**在唯一的出口上判断一次** —— 这里是鼠标位移变成 yaw 的
         唯一地方，守住它，上面三条路自动全都堵死。 */
      if (this._panelOpen()) { this.mouse.dx = 0; this.mouse.dy = 0; }
      else if (this.locked || this.lookMode === 'drag') {
        // 拖动模式的行程被窗口宽度限制住，灵敏度要高一些，手感才跟锁定时接近
        const sens = this.locked ? 0.0022 : 0.0040;
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
      // 先算加载集合再跑丧尸：丧尸的简化判定要用这一帧的结果
      C.Streaming.update(this.player.pos);
      C.ZombieManager.update(dt, this.player, this.time);
      C.SoundSystem.tickStats(dt);
      this._record(dt);

      this.renderer.update(this.player, this.time, dt);
      this.renderer.render();
      this.hud.draw(this.player, this.time, dt, this.renderer.camera);
      this.debug.draw(this.level, this.player, this.time);
      this.dbgCanvas.style.display = this.debug.visible ? 'block' : 'none';
      C.Touch.sync(this.player);
      C.LootUI.tickSearch(dt);
      C.LootUI.update(this.player);
      C.KitchenUI.update(this.player);
      C.TutorialUI.update(dt);
      C.HotbarUI.update();
      C.PanelUI.update(this.player);
      C.DeviceUI.update(this.player);
      /* 放置模式：每帧算一次落点。**它要在玩家移动之后算**，
         否则预览框会比画面慢一帧，看起来像在拖影。 */
      C.Placement.update(this.player, this.world);
      C.PlaceUI.update();
      this._tickKitchen(dt, dtHours);
      this._tickTutorial(dt);
      this.tapped = {};

      requestAnimationFrame((t) => this._frame(t));
    },

    /* 厨房与供电每帧推进。规则层只认游戏小时，噪音按真实秒发。 */
    _tickKitchen(dt, dtHours) {
      const day = this.time.day;
      C.Power.update(dtHours, day, this.time.isNight(), this.weather || 'clear');
      C.Cooking.update(this.time.totalGameSeconds / 3600, dtHours, this.level);
      C.Power.emitRunningNoise(dt);
      C.Cooking.emitProcessNoise(dt);
    },

    /** 身上有没有能解渴的东西（背包 + 六格快取位一起看） */
    _hasDrink(p) {
      const drinkable = (id) => { const d = C.ITEMS[id]; return d && d.use && d.use.thirst < 0; };
      if (p.hotbar.some(x => x && drinkable(x.id))) return true;
      return !!(p.bag && p.bag.items.some(x => drinkable(x.id)));
    },

    /* 教学触发（教学设计 4.2 触发表）。
       **按键提示只在该操作第一次在情境中变得必要时出现。**
       所以这里判断的是「情境」，不是「时间到了」。 */
    _tickTutorial(dt) {
      const T = C.Tutorial;
      if (!T.enabled || T.finished) return;
      const p = this.player, now = this.time.totalGameSeconds;
      const H = C.Config.level.floorHeight;
      const floor = Math.round(p.pos.y / H);
      const home = this.level.buildings && this.level.buildings.find(b => b.spec.spawn);
      const inHome = home && C.Streaming.buildingAt(p.pos) === home;

      /* ── 常驻目标卡片的第二句提示 ────────────────────
         触发的是**情境**，不是时间。每个目标只往前走一步，不回退。
         注意别把「换第二句」挂在会同时完成该目标的条件上（比如背上包、按下 Z），
         那样第二句永远不会被看到。 */
      const stage = (id) => { if (T.objective === id) T.advanceStage(1); };
      /* `[实测]` 这里判断的是「拿到了**能喝的**」，不是「口袋里有东西」——
         **开局身上就有 4 块石头**（投石是核心动作，不能一开始就用不了），
         写成「口袋非空」的话第二句提示在第 0 帧就跳出来了。 */
      if (this._hasDrink(p)) stage('drink');
      if (p.hotbar.every(x => x)) stage('bag');             // 口袋满了
      if (p.running && floor <= 1) stage('sound');          // 在楼下跑起来了
      if (floor === 0) stage('breaker');                    // 下到一楼
      if (p.charge > 0) stage('leave');                     // 开始蓄力投石

      // T01 视线落在可交互物上
      if (p.target || p.interactTarget) T.hint('T01', now);
      // T03 口袋满了还想捡
      if (!p.bag && p.hotbar.every(x => x)) T.hint('T03', now);
      // T05 暗处停留（夜里或没开灯的房间）
      if (this.time.isNight() && !p.flashlight) T.hint('T05', now);
      if (p.flashlight) { T.satisfied('T05'); T.hint('T06', now); }

      /* T09（屏息）**全表最重要的一条**：踏上二楼楼梯平台即触发。
         错过它，整个二楼的教学都会失效 —— 所以触发条件最宽松，且允许重复一次。 */
      if (inHome && floor <= 1 && !T.done.sound) {
        T.setObjective('sound');
        T.hint('T09', now);
      }
      if (p.holdBreath) { T.satisfied('T09'); T.completeObjective('sound'); }

      // T10/T11 有石头且在走廊里
      if (p.stoneCount() > 0 && p.target && p.target.type === 'loose') T.hint('T10', now);
      if (p.charge > 0) T.hint('T11', now);
      // T12 靠近开着的门
      if (p.interactTarget) T.hint('T12', now);
      // T13/T14 贴墙与探头
      if (p.wallHug) { T.hint('T13', now); T.hint('T14', now); }
      // T15 蹲行
      if (inHome && floor <= 1) T.hint('T15', now);
      // T16 天黑
      if (this.time.hour >= 19 && this.time.day === 1) { T.hint('T16', now); T.setObjective('sleep'); }
      /* 睡眠只差「关门」那一步时才换第二句 —— 提前说「按 U 睡觉」只会让人白按一次 */
      if (T.objective === 'sleep' && C.Sleep.check(p, this.level, C.ZombieManager.list).ok) stage('sleep');

      // 目标推进：喝到水 → 找包 → 烧水 → …
      /* 口渴只会自己涨、不会自己降，所以「降到 20 以下」= **确实喝到了**。
         开局是 30（见 00-config），不写死这两个数会立刻漂。 */
      if (!T.done.drink && p.needs.thirst < C.Config.needs.drinkGoalThirst) {
        T.completeObjective('drink'); T.setObjective('bag');
      }
      if (!T.done.bag && p.bag) { T.completeObjective('bag'); T.setObjective('boil'); T.hint('T04', now); }
      /* 插座没电 → 目标变成「配电间在一楼」。
         `[实测]` 触发条件从「站在楼上」改成「**真的把东西插上去了**」——
         之前楼上一站就弹「插上了，没反应」，可玩家根本还没插过任何东西。
         现在楼里有插座了（35-outlets），这句话终于对得上他刚做的动作。 */
      /* 分闸是**按楼层**的（见 24-campus），所以这里盯的是出生那一层的那一条。 */
      const homeCircuitId = home ? 'circuit-' + home.spec.id + '-' + C.Config.level.spawnRoomFloor : null;
      if (!T.done.boil && T.objective === 'boil' && inHome) {
        const c = homeCircuitId && C.Power.circuits.get(homeCircuitId);
        const pluggedHere = Object.keys(C.Outlets.plugged).length > 0;
        if (c && !c.breakerOn && pluggedHere) { T.hint('T07', now); T.hint('T08', now); stage('boil'); }
      }
      // 推上闸 → 目标完成
      const c2 = homeCircuitId && C.Power.circuits.get(homeCircuitId);
      if (c2 && c2.breakerOn && !T.done.breaker) {
        T.completeObjective('breaker'); T.completeObjective('boil');
        T.hint('T20', now);
        T.setObjective('leave');
      } else if (T.done.sleep && !T.done.breaker) {
        T.setObjective('breaker');
      }

      /* 走出宿舍楼、越过草坪 → **教学结束，UI 永久消失。**
         没有庆祝、没有「教学完成」字样。只是没有人再告诉你该干什么了。 */
      if (home && !inHome) {
        const f = home.footprint;
        const away = C.rectDist(f, p.pos.x, p.pos.z);
        if (away > 26) T.finish(C.Notebook, this.time);
      }
    },

    /* 笔记本的被动记录（14.3）。每帧都跑，所以贵的那部分要节流。
       「听见」在听觉回调里记（见 restart），这里只管「走过」和「看见」。 */
    _record(dt) {
      const N = C.Notebook;
      N.visitNode(this.level.graph.getNodeAt(this.player.pos), this.level, this.time);

      /* 看见：视锥内 + 有视线 + 25m 内。射线检测不便宜，0.4s 查一轮，
         而且只查离得近的那几只 —— 全校 320 只全查会把帧时间吃掉一半。 */
      this._seeT = (this._seeT || 0) + dt;
      if (this._seeT >= 0.4) {
        this._seeT = 0;
        const eye = this.player.eyePos();
        const fwd = { x: Math.sin(this.player.yaw), z: -Math.cos(this.player.yaw) };
        for (const z of C.ZombieManager.list) {
          if (!z.alive) continue;
          const dx = z.pos.x - eye.x, dz = z.pos.z - eye.z;
          const d = Math.hypot(dx, dz);
          if (d > 25 || d < 0.01) continue;
          if ((dx * fwd.x + dz * fwd.z) / d < 0.5) continue;        // 视锥外（半角 60°）
          if (!this.world.lineOfSight(eye, z.eyePos())) continue;
          N.observeZombie(z, '看见', this.time);
        }
      }

      const btn = document.getElementById('btnNote');
      if (btn) btn.classList.toggle('unread', N.unread > 0);
      // 开着的时候地图要跟着玩家动，但没必要每帧重画
      if (C.NotebookUI.open) {
        this._noteT = (this._noteT || 0) + 1;
        if (this._noteT % 12 === 0) C.NotebookUI.render();
      }
    },

    _resize() {
      if (!this.renderer) return;                 // 选角色阶段还没有渲染器
      // 手机上把渲染分辨率压到 1.25 倍：这套灰盒是四层楼几百个盒子，
      // 中端手机按 3x DPR 渲染会掉到 20fps 以下，潜行手感全毁。
      const vv = root.visualViewport;
      const w = Math.round(vv ? vv.width : innerWidth);
      const h = Math.round(vv ? vv.height : innerHeight);
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
