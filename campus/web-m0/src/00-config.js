/*
 * 00-config.js —— GameBalanceConfig
 * 对应《游戏设计文档 v1》11.4「数据资产」。
 * 硬约束：第三部分到第八部分出现的所有数字都必须在这里，业务代码不得硬编码。
 * 每个字段后面标注了它在文档里的出处，改数值时先回去看那一节的设计意图。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});

  C.Config = {
    // ── 时间（主文档 3.1）───────────────────────────────
    time: {
      secondsPerGameHour: 85,      // 1 游戏小时 = 85 秒真实
      dayStartHour: 7,             // 白天 07:00
      nightStartHour: 19,          // 夜晚 19:00
      nightFactor: 0.7,            // 夜间声音系数（k 的乘数）
      nightFadeStartHour: 19.0,    // 19:00 起 30 游戏分钟内平滑降到 0.7
      nightFadeHours: 0.5,
      dawnFadeStartHour: 5.5,      // 05:30 起平滑回到 1.0
      dawnFadeHours: 0.5,
      startHour: 9.0               // M0 默认从上午 9 点开始，方便测白天
    },

    // ── 声音传播（声音规格 3.1 / 4.3 / 9）──────────────
    sound: {
      kIndoor: 2.0,                // 室内每米衰减 2 点
      kOutdoor: 1.2,               // 室外每米衰减 1.2 点
      globalMinThreshold: 1,       // Dijkstra 剪枝下限 = 全场可能出现的最低听觉阈值
      outdoorOcclusion: 25,        // 室外同节点内被建筑遮挡时的额外扣减
      maxExpandedNodes: 400        // 安全阀，防止图数据出错时死循环
    },

    // ── 行为响度表（声音规格 6.1 + 主文档 4.3）─────────
    loudness: {
      holdBreath: 0,
      crouch: 10,
      wallHug: 14,
      walk: 20,
      run: 45,
      doorOpenSlow: 12,
      doorOpenFast: 35,
      doorCloseSlow: 10,           // 主文档 4.3：关门慢 10
      doorCloseFast: 30,           // 主文档 4.3：关门快 30
      doorSlam: 70,                // 撞门
      stoneImpact: 45,
      bottleImpact: 75,            // 玻璃瓶（M0 未放置，留作扩展）
      windowClimb: 30,
      glassBreak: 90,
      lootFast: 40,
      lootSlow: 15,          // 保留：门/窗的缓慢开关仍在用这一档「轻手轻脚」的响度
      grabBag: 18,           // 整个拎走一个包：不用翻，只有拎起来那一下的窸窣声
      meleeHit: 55,
      playerHurt: 60,
      broadcast: 150,
      zombieGrowl: 55,             // 主文档 5.4：追击低吼
      crawlerBreath: 12,           // 主文档 5.2：蜷伏者呼吸声
      exhaustedBreath: 25,         // 主文档 3.3：体力耗尽的喘息
      /* `[实测]` 丧尸站着不动时的低哑嘶吼。**这是主文档 13.1 待定问题 4 的答案：有。**
         定 28 而不是 48：屏息时室内 13m、室外 21m 能听见，比脚步(23m) 近一截 ——
         「站着的比走动的更难发现」既符合直觉，也保住了「移动会暴露自己」这条规则。
         隔一道关着的门只剩 1.5m，所以它基本只在同一个房间/走廊里起作用。
         关键是：**一只站着不动的丧尸不再是完全静默的**，屏息就能看见它的声纹。 */
      zombieIdleGrowl: 28,
      zombieShuffle: 48,           // 丧尸未发现玩家时的拖行脚步声。
                                   // 这一条回答了主文档 13.1 待定问题 4：玩家能听见丧尸的常态动静。
                                   // 48 是按「初始可听 20m」反推的：(48−8)/2 = 20。
                                   // 它比玩家奔跑(45)还响，这是有意的 —— 丧尸不在乎自己发出声音，玩家在乎。
                                   // 阈值 8 时同房间 20m、隔一扇开着的门 17.5m、隔一个楼梯口 15m ——
                                   // 关着的木门(衰减45)仍然完全挡死，这一点保持不变。
                                   // 尸体拖着脚在空楼里走本来就该很吵，介于玩家走路 20 与奔跑 45 之间。
      jumpLand: 35                 // 文档外：跳跃落地。翻越沿用 windowClimb(30)
    },

    // ── 连接类型衰减表（声音规格 6.2）──────────────────
    // null 表示该类型没有这个状态（例如门洞没有 Closed）。
    portalAttenuation: {
      Doorway:  { Open: 0,  Closed: null, Broken: null, Blocked: 60 },
      /* `[实测]` 关着的木门 45 → 25，关着的窗 40 → 28。
         45 比丧尸脚步(48)只低 3，等于**关上门就绝对听不见门后有什么**，
         于是屏息侦查在楼里彻底没用：实测站在四楼走廊屏息 30 秒，
         25m 内有 26 只丧尸，只听得见同一条走廊的 3 只。
         这同时也是待决策 #2（「关门是零代价的万能解」）的答案：
         关门仍然很有用（25 点≈室内 12.5m 的墙），但不再是绝对屏障。
         反向验算：玩家走路 20 透过关着的门只剩 −5，照样听不见；
         奔跑 45 剩 20，丧尸阈值 10 → 5m 内会被听见。潜行的保护还在。 */
      WoodDoor: { Open: 5,  Closed: 25,   Broken: 8,    Blocked: 75 },
      SteelDoor:{ Open: 6,  Closed: 70,   Broken: 10,   Blocked: 95 },
      Window:   { Open: 8,  Closed: 28,   Broken: 6,    Blocked: 70 },
      Stairwell:{ Open: 10, Closed: null, Broken: null, Blocked: 60 },
      Vent:     { Open: 30, Closed: null, Broken: null, Blocked: 80 },
      OpenAir:  { Open: 0,  Closed: null, Broken: null, Blocked: null },
      Curtain:  { Open: 20, Closed: 25,   Broken: null, Blocked: null }
    },
    // 哪些状态允许实体通行（声音规格 6.2：Blocked 同时阻断通行）
    portalPassable: { Open: true, Broken: true, Closed: false, Blocked: false },

    // ── 感知阈值（声音规格 6.3）────────────────────────
    hearing: {
      zombie: 10,
      zombieAlert: 6,
      crawler: 6,
      runner: 6,
      /* 玩家听觉：阈值越低听得越远。可听半径 =(响度 − 阈值)/k。
         初始 9，只比丧尸的 10 好一点点 —— 玩家不是超人，只是没那么迟钝。
         熟练度每级降阈值，也就是每级扩范围；屏息在当前等级上再减 holdBreathBonus。
         注意范围上限由**声源响度**决定，不由听力决定：所以等级对「很轻的声音」
         影响巨大（蜷伏者呼吸 12：Lv0 1.5m → Lv5 5m），对「很响的声音」影响有限。 */
      player: 8,
      playerLevelThreshold: [8, 6.8, 5.6, 4.4, 3.2, 2],
      /* `[实测]` 4 → 6。屏息是专门用来「仔细听」的动作，代价是几乎不能动
         （速度 ×0.5）加持续掉体力，收益却只有 2m，玩家感觉不到自己按了这个键。
         6 点 = 室内多听 3m、室外多听 5m，配合上面的门窗衰减才有「贴着门听」的玩法。 */
      holdBreathBonus: 6,
      minThreshold: 1,
      // 声纹只显示丧尸发出的声音（脚步、低吼、巡逻动静）；自己扔的石头、开的门不显示
      soundprintZombiesOnly: true,
      // 声纹明显度：margin 映射到 0~1 的强度，再决定标记大小与不透明度。
      // 满强度所需的 margin，超过就不再更明显。
      soundprintFullMargin: 20,   // 实测 26 太高，楼里常见的余量 10~20 永远到不了满强度
      baseAngleError: 60,          // 声纹基准方向角误差（度）
      // 声纹是否把声源位置直接透视标出来。对应主文档 8.5 听觉 Lv4「声纹穿透一层 Portal 显示」，
      // 默认开启等于把 Lv4 白送，正式版应改为按等级解锁。
      revealSource: true,
      // 距离模糊分级的 margin 门槛（声音规格 5.4：只给很近/中等/很远）
      distanceBands: { near: 35, mid: 12 }
    },

    // ── 丧尸反应（主文档 5.3 / 5.5，声音规格 5.2 / 5.3）
    zombieReaction: {
      delayBase: 3.0, delayPerMargin: 0.06, delayMin: 0.1, delayMax: 3.0,
      errorBase: 12.0, errorPerMargin: 0.25, errorMin: 0.0, errorMax: 12.0,
      switchTargetMarginBonus: 8,  // 已在调查时，新声音需高出 8 才切换目标
      searchDurationMin: 8, searchDurationMax: 15,
      loseTargetSeconds: 6,
      growlInterval: 1.5,
      chainMaxDepth: 2,            // 连锁最多传播 2 层
      maxChasers: 12,              // 同时追击上限
      visionCheckInterval: 0.2,    // 每 0.2 秒做一次视线检测
      recognitionTime: 0.8,        // 识别条 0.8 秒
      catchDistance: 0.9,          // 接触判定（M0 无战斗，接触即死）
      investigateSpeedMul: 1.6     // TODO 文档只定义了游荡 1.0 与追击 3.2，调查速度未定义，此为占位
    },

    // ── 丧尸类型（主文档 5.2）──────────────────────────
    zombieTypes: {
      Wanderer: {
        /* `[实测]` 速度从 v1 的 1.0 / 3.2 下调，两个值理由不同：
             游荡 1.0 m/s 是「正常人快走」，看着根本不像拖着腿的东西 ——
               而这是玩家 99% 的时间里看到的样子。两轮实测后压到 **0.45**
               （玩家蹲行 1.2 的三分之一），拖着腿的感觉才出来。
             追击 3.2 → **2.7**，仍然快过玩家走路 2.4，所以「被发现只能跑」这条没变，
               但留出了「跑两步拉开、拐个弯断视线」的余地，而不是必死。
           两个值都在调参面板里（P），手感不对可以现场改。 */
        name: '游荡者', hp: 100, threshold: 10,
        speedWander: 0.45, speedChase: 2.7,
        visionRadius: 14, visionAngle: 110, eyeHeight: 1.45,
        // 常态嘶吼：站着不动也会发出（见 loudness.zombieIdleGrowl）
        breathLoudness: 28, breathInterval: 3.0,
        shuffleInterval: 1.1          // 游荡/调查时每隔多久发一次脚步
      },
      Crawler: {
        name: '蜷伏者', hp: 100, threshold: 6,
        speedWander: 0.4, speedChase: 2.7,    // 刚从地上爬起来的，游荡时比游荡者还慢
        visionRadius: 14, visionAngle: 110, eyeHeight: 1.45,
        riseDistance: 8,            // 声源在 8 米内才起身
        breathInterval: 2.5,        // 呼吸声间隔（文档未给频率，此值为实测占位）
        shuffleInterval: 1.1
      },
      Runner: {                     // 第 12 天后才出现，M0 不放置，仅保留定义
        // 奔行者是唯一「跑得过玩家」的东西 —— 这一点不能动，它是第三幕的时钟
        name: '奔行者', hp: 60, threshold: 6,
        speedWander: 1.0, speedChase: 5.0,
        // 喘得比游荡者响、也比它频繁 —— 它是唯一「听见就该立刻跑」的东西
        breathLoudness: 36, breathInterval: 2.2,
        visionRadius: 18, visionAngle: 110, eyeHeight: 1.45, shuffleInterval: 0.8
      }
    },
    // 视觉修正（主文档 4.5）
    vision: {
      nightRadiusMul: 0.5,          // 夜间半径减半
      flashlightRadiusMul: 1.8,     // 持灯时在夜间半径基础上 ×1.8（14→7→12.6）
      crouchDetectMul: 0.6,
      peekDetectMul: 0.35
    },

    // ── 玩家（主文档 4.1 / 3.3）────────────────────────
    player: {
      speedWalk: 2.4, speedRun: 4.6, speedCrouch: 1.2, speedWallHug: 1.0,
      startingStones: 4,            // 开局身上的石头数（投石是核心动作，不能一开始就用不了）
      holdBreathSpeedMul: 0.5,      // 屏息时为蹲行速度的 50%
      eyeHeightStand: 1.65, eyeHeightCrouch: 1.05,
      radius: 0.32, stepHeight: 0.36,
      /* 跳跃与翻越。
         「攀爬/翻窗 −12 体力」在主文档 3.3 有定义，「翻窗(完好窗) 响度 30」在声音规格 6.1 有定义，
         所以翻越是文档内的机制。但**跳跃本身文档里没有**（4.1 的姿态表只有走/跑/蹲/贴墙/静止），
         这里的跳跃是应需求新增的，相关数值全部标注为文档外，方便日后一并砍掉或写回文档。 */
      gravity: 18.0,               // 文档外
      jumpSpeed: 4.2,              // 文档外：起跳初速，约能跳起 0.49m
      coyoteTime: 0.12,            // 文档外：离开地面后仍可起跳的宽限
      airControlMul: 0.65,         // 文档外：空中转向能力
      vaultMinHeight: 0.30,        // 低于这个高度直接靠 stepHeight 走上去，不触发翻越
      vaultMaxHeight: 1.45,        // 能翻越的最大高度（文档未定义，实测值）
      vaultProbeDistance: 1.7,     // 向前探测多远找可翻越的边缘
      vaultClearance: 0.95,        // 落点上方需要的净空（按蹲姿通过算，正好能钻窗）
      vaultDuration: 0.42,         // 翻越动作时长
      vaultLift: 0.35,             // 翻越轨迹的抬升幅度，纯表现
      /* 侧身：身体倾约 30°，但第一人称里唯一看得见的线索是画面翻滚，翻滚给一半（15°）
         就够读，再多就晕。违和感主要来自「瞬间切换」，所以加了 0.12s 的过渡。 */
      leanOffset: 0.45, leanAngle: 15, leanBodyAngle: 30, leanSmooth: 0.12,
      // 贴墙改为「单击进入/退出」的状态，进入后背贴墙面并切第三人称
      wallProbeDistance: 1.0, wallExitDistance: 1.35,
      /* 贴墙后朝向沿墙走向（不是朝墙外）：走廊只有 2.6m 深，朝墙外等于脸贴 2 米外的另一面墙，
         第三人称什么也看不见。掩体系统的通行做法就是「背贴墙、视线沿墙」。
         相机因此可以正常放在身后，再往走廊里推一点、抬高一点。 */
      thirdPersonBack: 2.8, thirdPersonAway: 0.6, thirdPersonUp: 0.6,
      peekYaw: 35,                  // 侧身探头的视角偏移
      // 脚步事件间隔（声音规格 4.4：跑约 0.35s，走约 0.7s）
      stepIntervalWalk: 0.7, stepIntervalRun: 0.35,
      stepIntervalCrouch: 1.0,      // TODO 文档未给蹲行步频，此值为占位
      stepIntervalWallHug: 1.1,     // TODO 同上
      stamina: {
        max: 100,
        runCost: 8, holdBreathCost: 3, climbCost: 12, meleeCost: 6,
        jumpCost: 6,               // 文档外：跳跃消耗，取攀爬(12)的一半
        regenStand: 6, regenCrouch: 9,
        exhaustedSpeedMul: 0.7,     // 体力归零移动速度 −30%
        exhaustedBreathInterval: 1.5
      },
      weightLimit: 20,              // 负重上限 kg（主文档 10.1）
      weightRatio: 0.0,             // 由背包实时算出；调试面板可覆盖
      weightLoudnessCoef: 0.5,      // 脚步响度 ×(1+0.5r)
      weightStaminaCoef: 0.8,       // 体力消耗 ×(1+0.8r)
      weightSpeedCoef: 0.25         // 奔跑速度 ×(1−0.25r)
    },

    // ── 交互（主文档 4.3）──────────────────────────────
    interact: {
      range: 2.2,
      doorSlowHoldSeconds: 2.5,
      doorCloseSlowHoldSeconds: 2.0,
      /* 容器只有一种翻法：快速。缓慢翻找（×2.25 时长换 −25 响度）在实测里
         从来没人用 —— 站在柜子前不动 9 秒的风险，远大于响度 40 传出去的风险，
         何况翻找期间玩家既聋又瞎。留一个用不上的选项只是在教程里多占一行字。 */
      lootFastSeconds: 4,
      grabBagHoldSeconds: 1.2      // 背包类容器：按住这么久 = 整个拎走
    },

    // ── 投掷（主文档 4.4）──────────────────────────────
    throwing: {
      gravity: 9.8,
      speedMin: 7, speedMax: 19, chargeSeconds: 1.2,
      arcSamples: 60,
      showLandingMarker: true,     // 落点标记
      showAudibleRing: true        // 落点的引怪半径圈 = (响度 − 丧尸阈值) / k，
                                   // 让玩家能直接看到「这一下会惊动多大范围」（支柱三）
    },

    // ── 熟练度（主文档 8.5）：M0 只接入静步与听觉两项 ──
    skills: {
      quietStep: { level: 0, loudnessReduction: [0, 0.08, 0.16, 0.24, 0.32, 0.40] },
      hearing:   { level: 0, errorReduction:    [0, 0.15, 0.30, 0.45, 0.60, 0.75] }
    },

    // ── 灰盒宿舍楼（主文档 9.3 / 9.6）─────────────────
    level: {
      floors: 4, roomsPerFloor: 6,
      roomW: 4.0, roomD: 5.0, roomGap: 1.0,
      /* `[实测]` 走廊 2.6 → 3.4m。2.6m 是「两个人勉强错身」的宽度，
         第一人称里两侧墙压在脸上，而走廊是这个游戏里待得最久的地方。
         3.4m 还是窄的（真实教学楼走廊 2.4~3m），但配合 78° FOV 才不憋。 */
      corridorD: 3.4, floorHeight: 3.2, wallThickness: 0.2,
      stairWellW: 6.0, stairWellD: 6.0,
      stairStepH: 0.2, stairStepD: 0.3, stairWidth: 2.4, stairSlabThickness: 0.45,
      spawnRoomFloor: 3,            // 0-based：第 4 层
      spawnRoomIndex: 1             // 402 = 4 楼第 2 间
    },

    /* ── 渲染 ────────────────────────────────────────
       fogFar 之外什么都看不见，所以丧尸的绘制距离跟着它走 ——
       两个数分开写迟早会漂：要么在雾里看见丧尸凭空消失，要么白画一堆看不见的。 */
    render: {
      fogNear: 12, fogFar: 60,
      zombieDistance: 65      // 比 fogFar 略大：正好在雾边缘的那一只别闪没了
    },

    /* ── 全校地图（主文档 13.1 / 13.3 / 13.4）─────────────
       M2 的布局表。**这里是全校几何的唯一出处** —— 24-campus.js 只负责把它变成盒子。
       坐标系：x 向东，z 向北，原点在正门广场。宿舍区在最北，离校门最远（13.1）。
       每栋楼都是同一个板楼模板：一条走廊（南）+ 一排房间（北）+ 0~2 个楼梯间。 */
    campus: {
      wall: { x0: -96, x1: 136, z0: -12, z1: 148, height: 3.0, thickness: 0.4 },

      /* 室外分区。**互不重叠地平铺**整个校园 —— 重叠的话 getNodeAt 会时灵时不灵。
         y 上界要盖过最高的楼（教学楼 5 层 = 16m），室内节点优先命中。 */
      zones: [
        { id: 'plaza',  name: '正门广场', x0: -100, x1: 140, z0: -16, z1: 12 },
        { id: 'road',   name: '主校道',   x0: -100, x1: 140, z0: 12,  z1: 34 },
        { id: 'teach',  name: '教学区',   x0: -100, x1: 30,  z0: 34,  z1: 70 },
        { id: 'mess',   name: '食堂前坪', x0: 30,   x1: 140, z0: 34,  z1: 70 },
        { id: 'alley',  name: '林荫道',   x0: -100, x1: 140, z0: 70,  z1: 86 },
        { id: 'yard',   name: '后院',     x0: -100, x1: 30,  z0: 86,  z1: 122 },
        { id: 'field',  name: '操场',     x0: 30,   x1: 140, z0: 86,  z1: 122 },
        { id: 'dormArea', name: '宿舍区', x0: -100, x1: 140, z0: 122, z1: 152 }
      ],
      zoneY: { min: -1, max: 40 },
      // 相邻分区之间的开放空气连接（衰减 0，只按距离衰减）
      zoneLinks: [
        ['plaza', 'road'], ['road', 'teach'], ['road', 'mess'], ['teach', 'mess'],
        ['teach', 'alley'], ['mess', 'alley'], ['alley', 'yard'], ['alley', 'field'],
        ['yard', 'field'], ['yard', 'dormArea'], ['field', 'dormArea']
      ],

      /* 建筑表。firstDay 是「首次可达」的软引导（13.1），不是硬锁。
         zombies 是这栋楼分到的丧尸数，全表加上 outdoorZombies 正好 320（7.1）。 */
      buildings: [
        { id: 'dormM', name: '男生宿舍楼', prefix: '男', ox: -70, oz: 128, floors: 4, rooms: 6,
          stairs: ['west', 'east'], zone: 'dormArea', roomType: 'dorm', firstDay: 1, zombies: 26, spawn: true },
        { id: 'dormF', name: '女生宿舍楼', prefix: '女', ox: 10, oz: 128, floors: 4, rooms: 6,
          stairs: ['west', 'east'], zone: 'dormArea', roomType: 'dorm', firstDay: 1, zombies: 28 },
        { id: 'teachA', name: '教学楼A', prefix: '教A', ox: -80, oz: 40, floors: 5, rooms: 8,
          stairs: ['west', 'east'], zone: 'teach', roomType: 'classroom', firstDay: 2, zombies: 55 },
        { id: 'teachB', name: '教学楼B', prefix: '教B', ox: -20, oz: 40, floors: 5, rooms: 6,
          stairs: ['west', 'east'], zone: 'teach', roomType: 'classroom', firstDay: 3, zombies: 40 },
        { id: 'lab', name: '实验楼', prefix: '实', ox: -80, oz: 58, floors: 3, rooms: 6,
          stairs: ['west', 'east'], zone: 'teach', roomType: 'lab', firstDay: 4, zombies: 22 },
        { id: 'library', name: '图书馆', prefix: '图', ox: -30, oz: 58, floors: 3, rooms: 5,
          stairs: ['west'], zone: 'teach', roomType: 'library', firstDay: 5, zombies: 14 },
        { id: 'canteen', name: '食堂', prefix: '食', ox: 50, oz: 40, floors: 2, rooms: 4,
          stairs: ['west'], zone: 'mess', roomType: 'canteen', firstDay: 3, zombies: 30,
          roomW: 8, roomGap: 1.5, roomD: 10, corridorD: 3.2 },
        { id: 'clinic', name: '医务室', prefix: '医', ox: 100, oz: 40, floors: 1, rooms: 3,
          stairs: [], zone: 'mess', roomType: 'clinic', firstDay: 4, zombies: 6 },
        { id: 'admin', name: '行政楼', prefix: '行', ox: 100, oz: 58, floors: 4, rooms: 5,
          stairs: ['west', 'east'], zone: 'mess', roomType: 'office', firstDay: 7, zombies: 24 },
        { id: 'gym', name: '体育馆', prefix: '体', ox: -70, oz: 92, floors: 2, rooms: 3,
          stairs: ['west'], zone: 'yard', roomType: 'gym', firstDay: 6, zombies: 16,
          roomW: 12, roomGap: 2, roomD: 14, corridorD: 3.5 },
        { id: 'boiler', name: '锅炉房', prefix: '锅', ox: -15, oz: 110, floors: 1, rooms: 2,
          stairs: [], zone: 'yard', roomType: 'boiler', firstDay: 6, zombies: 5 },
        { id: 'guard', name: '保安室', prefix: '保', ox: 44, oz: -8, floors: 1, rooms: 4,
          stairs: [], zone: 'plaza', roomType: 'guard', firstDay: 8, zombies: 6 },
        { id: 'shop', name: '小卖部', prefix: '店', ox: -30, oz: -8, floors: 1, rooms: 3,
          stairs: [], zone: 'plaza', roomType: 'shop', firstDay: 2, zombies: 5 }
      ],
      // 室外丧尸：正门附近最密（13.1「保安室周边丧尸最密」）
      outdoorZombies: [
        { zone: 'plaza', count: 14 }, { zone: 'road', count: 12 },
        { zone: 'field', count: 8 }, { zone: 'yard', count: 5 }, { zone: 'alley', count: 4 }
      ],
      // 露天构筑物：车棚（第 5 天）与操场看台（第 4 天）
      carport: { x0: -5, x1: 20, z0: 92, z1: 104, height: 2.8 },
      bleachers: { x0: 40, x1: 120, z0: 88, z1: 91, height: 1.2 },

      /* 出入口（13.3）。封锁所需建材写在这里，结局二会用。
         side 是它开在围墙的哪一面，a0/a1 是沿墙方向的开口范围。 */
      exits: [
        { id: 'front', name: '正门',     side: 'south', a0: 12,  a1: 20,  barricade: 5 },
        { id: 'back',  name: '后门',     side: 'north', a0: -4,  a1: 2,   barricade: 3 },
        { id: 'east',  name: '东侧门',   side: 'east',  a0: 42,  a1: 48,  barricade: 3 },
        { id: 'gapW1', name: '西墙破口一', side: 'west', a0: 52,  a1: 56,  barricade: 2 },
        { id: 'gapW2', name: '西墙破口二', side: 'west', a0: 100, a1: 104, barricade: 2 },
        { id: 'gapN1', name: '北墙破口',   side: 'north', a0: -60, a1: -56, barricade: 2 }
      ],

      // 丧尸总量与配比（7.1 / 7.2）。奔行者第 12 天前按游荡者行为走。
      zombieTotal: 320,
      crawlerRatio: 0.10, runnerRatio: 0.05,
      runnerFromDay: 12,
      zombieSeed: 20260905,

      /* 分区加载（13.4）。声图全量常驻，加载的只是几何与「完整模拟」的名额。
         半径按「主校道能看到两侧的楼」定：60m 覆盖相邻分区，再远的楼交给雾。 */
      streaming: { loadRadius: 60, unloadRadius: 78, simplifyRadius: 60 },
      simplifiedTick: 0.25          // 简化模拟的更新间隔（秒）
    },

    // ── 生存需求（主文档 3.2 / 3.3 / 3.4）──────────────
    needs: {
      barLength: 100,
      thirstFullHours: 30,       // 口渴从 0 涨满 100 需 30 游戏小时
      hungerFullHours: 96,       // 饥饿 96 小时
      fatigueRatePerHour: 5,     // 清醒时困乏 +5/小时（20 小时挤满）
      fatigueSleepPerHour: 12,   // 睡眠时 −12/小时
      diarrheaThirstMul: 2, diarrheaHours: 8,
      // 精力充沛 buff
      restedBeforeHour: 22, restedMinHours: 6, restedDurationHours: 24,
      restedFatigueMul: 0.75, restedStaminaRegenMul: 1.15
    },
    // 消耗品（主文档 3.2 恢复量表）。M0 没有背包，用快取位存几样试数值。
    items: {
      water:    { name: '瓶装水 500ml', thirst: -25, hunger: 0 },
      boiled:   { name: '煮沸的水',     thirst: -22, hunger: 0 },
      raw:      { name: '未处理的水',   thirst: -25, hunger: 0, diarrheaChance: 0.4 },
      biscuit:  { name: '饼干',         thirst: -3,  hunger: -12 },
      noodleDry:{ name: '泡面(干吃)',   thirst: 5,   hunger: -15 },
      noodleHot:{ name: '泡面(泡开)',   thirst: -8,  hunger: -25 },
      cooked:   { name: '烹饪食物',     thirst: -5,  hunger: -35 }
    },
    sleep: {
      maxHours: 10, defaultHours: 8,
      interruptMargin: 15,       // 睡眠中 margin > 15 的声音会惊醒
      timeScale: 90,             // 睡眠时时间加速倍率
      bedRange: 1.6              // 离床多近才算「有床」
    },

    /* ── 配方（主文档 10.4 / 10.5）─────────────────────
       M2 只做「笔记本第三页把它们列出来」这一件事，真正的制作在 M3。
       unlock 是解锁它的书：课本给基础的，技术手册给需要手艺的（10.2「书籍解锁配方」）。 */
    recipes: [
      { id: 'boilWater',  name: '煮水',       need: '水 + 容器',            note: '净化来路不明的水', unlock: 'textbook' },
      { id: 'riceMeal',   name: '白饭',       need: '米 + 水',              note: '饥饿 −30',        unlock: 'textbook' },
      { id: 'hotNoodle',  name: '泡面',       need: '方便面 + 热水',        note: '饥饿 −25',        unlock: 'textbook' },
      { id: 'bandage',    name: '绷带',       need: '布 ×2',                note: '',                unlock: 'textbook' },
      { id: 'plank',      name: '建材',       need: '木板/课桌 + 工具',      note: '封锁出入口要用',   unlock: 'textbook' },
      { id: 'rainCatch',  name: '雨水收集器', need: '容器 + 塑料布 + 建材', note: '手艺 1',          unlock: 'manual' },
      { id: 'clock',      name: '闹钟',       need: '闹钟零件 ×2 + 电池',   note: '手艺 2',          unlock: 'manual' },
      { id: 'muffle',     name: '消音布',     need: '布 ×3',                note: '手艺 2，静步 −15%', unlock: 'manual' },
      { id: 'reinforce',  name: '长柄武器加固', need: '武器 + 建材 + 工具', note: '手艺 3',          unlock: 'manual' },
      { id: 'repairPart', name: '修理零件',   need: '废零件 ×3 + 工具',     note: '手艺 3',          unlock: 'manual' }
    ],

    // ── 调试 ──────────────────────────────────────────
    debug: {
      // 声纹只在屏息时可见（主文档 10.1）。听得见 ≠ 看得见：常态下你听见动静但屏幕上没有标记，
    // 想确认它在哪就必须停下来屏息 —— 这正是屏息作为侦查动作的代价。
    /* 探索用的两个开关。**正式版必须砍掉或锁进开发者构建。**
       分成两个是因为它们回答的问题不同：
         godMode —— 想安心走遍全校，但仍然想看丧尸怎么反应
         ghost   —— 想观察「没有玩家干扰时」丧尸自己在干什么
       ghost 只关掉视觉，**听觉照常** —— 你踩出的脚步它还是听得见，
       所以它不是「上帝模式」，而是「隐形人」。 */
    godMode: false,
    ghost: false,
    showSoundprintAlways: false,
      soundprintLifetime: 1.6,
      logMaxEntries: 60
    }
  };

  // 深拷贝一份出厂值，调试面板「重置」用。
  C.ConfigDefaults = JSON.parse(JSON.stringify(C.Config));
})(typeof globalThis !== 'undefined' ? globalThis : this);
