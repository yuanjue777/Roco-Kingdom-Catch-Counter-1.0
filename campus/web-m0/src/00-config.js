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
      doorBang: 70,                // 被锁住的丧尸扑门（主文档响度表）
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
      /* 出手点相对眼睛的偏移 = 右手的位置。从眼睛正中抛出去的弧线左右对称，
         看着像「从脑门射出来」；挪到右肩下方，弧线才是斜着从画面右下角甩出去的。 */
      handRight: 0.30, handDown: 0.22, handForward: 0.18,
      landMarkerSeconds: 1.6,       // 落点标记停留多久
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

    /* ══════════════════════════════════════════════════
       供电（烹饪与供电规格 第二部分）
       电与水、食物并列，是第三条生命线。
       ══════════════════════════════════════════════════ */
    power: {
      /* 两个基础设施在三天内相继崩塌，构成第二幕的双重推力。 */
      waterCutDay: 8,             // 自来水停供（主文档 10.3，不变）
      gridFailDay: 11,            // **市电永久中断**，第 11 天 00:00

      sources: {
        grid:     { name: '市电',         watt: 2200, fuel: null,     perHour: 0,    loud: 0,  weight: 0    },
        genBig:   { name: '柴油发电机',   watt: 3000, fuel: 'diesel', perHour: 0.45, loud: 65, weight: 28   },
        genSmall: { name: '小型发电机',   watt: 1200, fuel: 'diesel', perHour: 0.20, loud: 52, weight: 14   },
        battery:  { name: '汽车电瓶',     watt: 1000, fuel: 'charge', perHour: 0,    loud: 5,  weight: 16,
                    capacityWh: 600, chargeHours: 1 },
        solar:    { name: '太阳能板',     watt: 0,    fuel: null,     perHour: 0,    loud: 0,  weight: 7 }
      },
      /* 太阳能：三块全找到 = 晴天 660W。不够跑电磁炉(2000)，
         但够跑电炖锅(300) 并给电瓶充电 —— **这就是自持期的全部资本。** */
      solarOutput: { clearDay: 220, cloudy: 110, rain: 40, night: 0 },
      solarPanels: 3,
      dieselTotalLitres: 46,      // 锅炉房 30 / 车棚 8 / 行政楼 5 / 校车 3

      /* 电线。长度累加，**按世界空间距离判定**，不是节点距离。 */
      cables: {
        shortWire: { name: '短电线',     metres: 3,  sockets: 1, weight: 0.3 },
        powerStrip:{ name: '插线板',     metres: 5,  sockets: 4, weight: 0.6 },
        extension: { name: '工程延长线', metres: 15, sockets: 2, weight: 2.4 },
        cableReel: { name: '电缆盘',     metres: 30, sockets: 3, weight: 6.0 }
      },

      // 设备功率表（规格 2.5）
      devices: {
        inductionHob: 2000, kettle: 1500, ceramicHob: 1500, microwave: 1200,
        riceCooker: 800, slowCooker: 300, fridge: 150, deskLamp: 40,
        charger: 20, beacon: 500
      },

      breakerLoudness: 25,        // 推闸
      tripLoudness: 40,           // 跳闸「啪」的一声
      genSetLoudness: 65,
      // 回路修复门槛（规格 2.2）
      repairSkillLevel: 2
    },

    /* ══════════════════════════════════════════════════
       食材与腐败（规格 第六部分）
       spoilHours = freshness 从 100 掉到 0 所需游戏小时。
       ══════════════════════════════════════════════════ */
    food: {
      /* 腐败分级（规格 6.4）。**冷藏（通电小冰箱）速率 ×0.15** ——
         「为了保住冰箱里的东西而必须维持供电」是很好的压力来源。 */
      tiers: [
        { min: 60, label: '新鲜',   satietyMul: 1.0,  sickChance: 0 },
        { min: 25, label: '不新鲜', satietyMul: 0.75, sickChance: 0 },
        { min: 1,  label: '变质',   satietyMul: 0.4,  sickChance: 0.5 },
        { min: 0,  label: '腐烂',   satietyMul: 0,    sickChance: 0, rotten: true }
      ],
      fridgeSpoilMul: 0.15,
      sealedJarSpoilMul: 0.5,
      rottenOdorThreshold: 2,       // 腐烂食材让所在节点阈值 −2

      /* 分类腐败速率（游戏小时）。不腐的写 Infinity。 */
      categorySpoilHours: {
        staple: 720, canned: Infinity, dried: Infinity, pickled: 480,
        root: 288, leafy: 72, egg: 192, meat: 48, meatChilled: 192,
        seasoning: Infinity, cooked: 8
      },

      /* 生食与零食（规格 8.2）。**thirst 为正 = 加渴。**
         规则一：干的加渴、湿的解渴 —— 早期靠零食活着，水会消耗得特别快。
         这是一种不需要教程的教学。 */
      raw: {
        biscuit:    { name: '饼干',           cat: 'staple',  satiety: 8,  thirst: 4  },
        bread:      { name: '面包',           cat: 'staple',  satiety: 12, thirst: 2, spoilHours: 96 },
        sausage:    { name: '火腿肠',         cat: 'pickled', satiety: 10, thirst: 5  },
        chocolate:  { name: '巧克力',         cat: 'staple',  satiety: 9,  thirst: 3, staminaRegenMul: 1.3, buffMinutes: 5 },
        noodleDry:  { name: '方便面(干吃)',   cat: 'staple',  satiety: 12, thirst: 9  },
        canned:     { name: '午餐肉罐头',     cat: 'canned',  satiety: 20, thirst: 7  },
        cannedFish: { name: '豆豉鲮鱼罐头',   cat: 'canned',  satiety: 16, thirst: 9  },
        cannedFruit:{ name: '水果罐头',       cat: 'canned',  satiety: 10, thirst: -12 },
        pickle:     { name: '咸菜',           cat: 'pickled', satiety: 4,  thirst: 10 },
        eggRaw:     { name: '生鸡蛋',         cat: 'egg',     satiety: 8,  thirst: 1, sickChance: 0.3 },
        meatRaw:    { name: '生肉',           cat: 'meat',    satiety: 12, thirst: 2, sickChance: 0.7 },
        fishRaw:    { name: '生鱼',           cat: 'meat',    satiety: 12, thirst: 2, sickChance: 0.7 },
        ratMeat:    { name: '鼠肉',           cat: 'meat',    satiety: 14, thirst: 2, sickChance: 0.7 }
      },
      drinks: {
        water:      { name: '矿泉水 500ml',   satiety: 0,  thirst: -24 },
        boiled:     { name: '煮沸净水 500ml', satiety: 0,  thirst: -22 },
        soda:       { name: '可乐 330ml',     satiety: 6,  thirst: -10 },
        milk:       { name: '牛奶 250ml',     satiety: 9,  thirst: -11, spoilHours: 72 },
        dirtyWater: { name: '未处理水 500ml', satiety: 0,  thirst: -24, sickChance: 0.4 }
      },

      /* 现场获取（规格 6.3）—— **唯一的再生蛋白来源，也是后期的生命线。** */
      renewable: {
        koi:     { name: '锦鲤',   at: '中庭水池', perDay: 2, loud: 15, gives: 'fishRaw' },
        sparrow: { name: '麻雀',   at: '屋顶',     perDay: 1, loud: 5,  gives: 'meatRaw', needsTrap: true },
        rat:     { name: '老鼠',   at: '食堂',     perDay: 1, loud: 8,  gives: 'ratMeat', needsTrap: true }
      },

      /* 种植（规格 11.2）。**奖励远见的机制，不是日常任务 —— 不给任何 UI 提醒。**
         回报周期 8~14 天长于大多数玩家的耐心：第 5 天想到就有饭吃，第 20 天才想起来就来不及。 */
      crops: {
        bokchoy: { name: '小白菜', days: 8,  yield: 4, waterPerDay: 0.5, gives: 'cabbage' },
        radish:  { name: '萝卜',   days: 12, yield: 3, waterPerDay: 0.4, gives: 'radish' },
        potato:  { name: '土豆',   days: 14, yield: 5, waterPerDay: 0.4, gives: 'potato' }
      },
      cropMissDayPenalty: 2, cropDeathAfterMissed: 3, plots: 5
    },

    /* ══════════════════════════════════════════════════
       烹饪（烹饪与供电规格 第四~九部分）
       核心张力：**吃得好 vs 被听见。**
       ══════════════════════════════════════════════════ */
    cooking: {
      /* 加热设备。speedFactor 乘在食谱基准时间上；autoShutoff=false 的需要看火。 */
      heaters: {
        inductionHob: { name: '电磁炉', watt: 2000, idle: 18, sauteLoud: 45, needsCookware: true,  speed: 1.0,  autoShutoff: false, done: 0 },
        ceramicHob:   { name: '电陶炉', watt: 1500, idle: 12, sauteLoud: 45, needsCookware: true,  speed: 1.35, autoShutoff: false, done: 0 },
        riceCooker:   { name: '电饭煲', watt: 800,  idle: 10, sauteLoud: 0,  needsCookware: false, speed: 1.0,  autoShutoff: true,  done: 22 },
        kettle:       { name: '电水壶', watt: 1500, idle: 15, sauteLoud: 0,  needsCookware: false, speed: 0.5,  autoShutoff: true,  done: 35 },
        microwave:    { name: '微波炉', watt: 1200, idle: 30, sauteLoud: 0,  needsCookware: true,  speed: 0.4,  autoShutoff: true,  done: 50 },
        slowCooker:   { name: '电炖锅', watt: 300,  idle: 8,  sauteLoud: 0,  needsCookware: false, speed: 3.0,  autoShutoff: true,  done: 0 },
        campStove:    { name: '卡式炉', watt: 0,    idle: 20, sauteLoud: 45, needsCookware: true,  speed: 1.0,  autoShutoff: false, done: 0, fuel: 'butane' }
      },
      butaneCans: 5, butaneHoursPerCan: 3,

      /* 锅具。tags 决定能做哪些食谱，satiety/thirst 是百分比加成。 */
      cookware: {
        wok:      { name: '铁炒锅',       weight: 2.2, tags: ['fry'],                satiety: 0.15, thirst: 0    },
        stockpot: { name: '不锈钢汤锅',   weight: 1.4, tags: ['boil', 'soup'],       satiety: 0,    thirst: 0    },
        clayPot:  { name: '砂锅',         weight: 2.6, tags: ['boil', 'soup'],       satiety: 0.10, thirst: 0.25, fragile: 0.20 },
        pressure: { name: '高压锅',       weight: 3.1, tags: ['boil', 'pressure'],   satiety: 0,    thirst: 0,    timeMul: 0.4, ventLoud: 55, ventQuietLoud: 20, ventQuietMinutes: 15 },
        steamer:  { name: '蒸锅',         weight: 1.8, tags: ['steam'],              satiety: 0,    thirst: 0,    buffMul: 1.5 },
        skillet:  { name: '平底锅',       weight: 1.1, tags: ['fry'],                satiety: 0,    thirst: 0    },
        milkPot:  { name: '奶锅',         weight: 0.6, tags: ['boil'],               satiety: 0,    thirst: 0,    halfBatch: true, timeMul: 0.6 },
        glassBox: { name: '玻璃饭盒',     weight: 0.4, tags: ['microwave'],          satiety: 0,    thirst: 0    }
      },
      /* **兼容矩阵必须严格实现。** 电磁炉配砂锅是玩家最容易犯的错误 ——
         开机没反应，提示「锅具不兼容」。这是一个无害但印象深刻的教学时刻。
         它还有一个漂亮的后果：电磁炉 2000W 在自持期用不了，
         而砂锅偏偏只能配电陶炉/卡式炉/电炖锅 ——
         **最好的汤锅，要等到最难的时候才真正登场。** */
      compat: {
        inductionHob: ['wok', 'stockpot', 'pressure', 'steamer', 'skillet', 'milkPot'],
        ceramicHob:   ['wok', 'stockpot', 'clayPot', 'pressure', 'steamer', 'skillet', 'milkPot'],
        campStove:    ['wok', 'stockpot', 'clayPot', 'pressure', 'steamer', 'skillet', 'milkPot'],
        microwave:    ['glassBox'],
        riceCooker:   [], kettle: [], slowCooker: []      // 自带内胆，不接外锅
      },

      /* 火候（规格 9.1）。黄金窗口内 100%，过火期线性衰减到 40%，再往后报废。 */
      goldenWindowRatio: 0.20,
      overcookRatio: 0.60,
      overcookFloor: 0.40,
      ruinedSatiety: 5, ruinedOdor: 3,
      overcookOdorAdd: 1, overcookLoudAdd: 10,

      // 调味料：**乘数不是加数**，每种 +8%，最多 3 种
      seasoningBonus: 0.08, seasoningMaxSlots: 3,

      // 熟食保质（规格 8.4）：不能囤积成品，做饭必须是每天都要做的事
      cookedFreshHours: 8, cookedInContainerHours: 20,

      /* 气味（规格 10.2）。不做传播模拟，是一个区域性的临时修正。
         等级 3 会让相邻节点的丧尸阈值从 10 降到 4，持续两个多小时。 */
      odorThresholdPerLevel: 2,
      odorMinutesPerLevel: 45,

      // 净化（规格 7.2）
      boilKettleHours: 0.15, boilPotHours: 0.4,
      unboiledDiarrheaChance: 0.4
    },

    /* ══════════════════════════════════════════════════
       食谱（规格 第八部分）
       time = 基准游戏分钟，实际 = 基准 × 设备速度系数 × 锅具系数。
       loud = 烹饪过程中的持续响度，**不含设备结束提示音**。
       thirst 为负=解渴、为正=加渴。odor 0~3。
       ══════════════════════════════════════════════════ */
    recipes: [
      /* Lv0 · 初始可用 */
      { id: 'boilWater', name: '烧水',   lv: 0, need: { water: 1 },                          heater: 'any', pot: ['boil'],            time: 9,  satiety: 0,  thirst: 0,   loud: 15, odor: 0, gives: 'boiled' },
      { id: 'riceMeal',  name: '白米饭', lv: 0, need: { rice: 1, water: 1 },                  heater: 'any', pot: ['boil'],            time: 45, satiety: 22, thirst: -4,  loud: 10, odor: 1 },
      { id: 'hotNoodle', name: '泡面',   lv: 0, need: { noodle: 1, boiled: 1 },               heater: 'none',pot: [],                  time: 5,  satiety: 20, thirst: -6,  loud: 5,  odor: 1 },
      { id: 'boiledEgg', name: '煮鸡蛋', lv: 0, need: { egg: 2, water: 1 },                   heater: 'any', pot: ['boil'],            time: 12, satiety: 16, thirst: -2,  loud: 12, odor: 0 },
      { id: 'plainNoodle',name:'煮挂面', lv: 0, need: { driedNoodle: 1, water: 1 },           heater: 'any', pot: ['boil'],            time: 15, satiety: 21, thirst: -8,  loud: 12, odor: 1 },
      { id: 'congee',    name: '白粥',   lv: 0, need: { rice: 1, water: 2 },                  heater: 'any', pot: ['boil', 'soup'],    time: 70, satiety: 18, thirst: -24, loud: 8,  odor: 1 },
      { id: 'bakedPotato',name:'烤土豆', lv: 0, need: { potato: 2 },                          heater: 'any', pot: ['fry', 'microwave'],time: 20, satiety: 19, thirst: 2,   loud: 15, odor: 1 },

      /* Lv1 */
      { id: 'eggRice',   name: '蛋炒饭',       lv: 1, need: { riceMeal: 1, egg: 1, oil: 1 },              heater: 'any', pot: ['fry'],          time: 12, satiety: 30, thirst: -3,  loud: 45, odor: 2 },
      { id: 'tomatoSoup',name: '番茄鸡蛋汤',   lv: 1, need: { tomato: 1, egg: 1, water: 2 },              heater: 'any', pot: ['soup'],         time: 25, satiety: 20, thirst: -30, loud: 14, odor: 2 },
      { id: 'congeePickle',name:'咸菜配粥',    lv: 1, need: { congee: 1, pickle: 1 },                     heater: 'none',pot: [],               time: 0,  satiety: 23, thirst: -16, loud: 0,  odor: 1 },
      { id: 'potatoStew',name: '土豆炖萝卜',   lv: 1, need: { potato: 2, radish: 1, water: 1, salt: 1 },  heater: 'any', pot: ['boil'],         time: 55, satiety: 28, thirst: -10, loud: 16, odor: 2 },
      { id: 'friedEgg',  name: '煎蛋',         lv: 1, need: { egg: 2, oil: 1 },                           heater: 'any', pot: ['fry'],          time: 6,  satiety: 18, thirst: 1,   loud: 38, odor: 2 },

      /* Lv2 */
      { id: 'friedCabbage',name:'炒白菜',      lv: 2, need: { cabbage: 1, oil: 1, garlic: 1 },            heater: 'any', pot: ['fry'],          time: 8,  satiety: 22, thirst: -6,  loud: 45, odor: 2 },
      { id: 'mushroomNoodle',name:'香菇鸡蛋面',lv: 2, need: { driedNoodle: 1, mushroom: 1, egg: 1, water: 2 }, heater:'any', pot: ['soup'],     time: 22, satiety: 32, thirst: -26, loud: 14, odor: 2 },
      { id: 'spamRice',  name: '午餐肉炒饭',   lv: 2, need: { riceMeal: 1, canned: 1, onion: 1, oil: 1 },  heater: 'any', pot: ['fry'],          time: 14, satiety: 36, thirst: -2,  loud: 45, odor: 3 },
      { id: 'pressureBeef',name:'高压土豆牛肉',lv: 2, need: { potato: 2, meat: 1, water: 1 }, seasoning: 2,heater: 'any', pot: ['pressure'],     time: 24, satiety: 40, thirst: -8,  loud: 20, odor: 3 },
      { id: 'steamedEgg',name: '蒸鸡蛋羹',     lv: 2, need: { egg: 2, water: 1, salt: 1 },                heater: 'any', pot: ['steam'],        time: 18, satiety: 24, thirst: -14, loud: 12, odor: 1 },

      /* Lv3 */
      { id: 'beancurdSoup',name:'腐竹木耳汤',  lv: 3, need: { beancurd: 1, fungus: 1, water: 3 }, seasoning: 2, heater: 'any', pot: ['soup'],   time: 50, satiety: 26, thirst: -34, loud: 12, odor: 2 },
      { id: 'braisedFish', name:'红烧鱼',      lv: 3, need: { fish: 1, oil: 1, soySauce: 1, ginger: 1 },  heater: 'any', pot: ['fry'],          time: 20, satiety: 38, thirst: -4,  loud: 45, odor: 3 },
      { id: 'friedNoodle', name:'什锦炒面',    lv: 3, need: { driedNoodle: 1, cabbage: 1, sausage: 1, oil: 1 }, seasoning: 1, heater: 'any', pot: ['fry'], time: 16, satiety: 38, thirst: -4, loud: 45, odor: 3 },
      /* **本作烹饪系统的顶点。** 3 小时、砂锅、电炖锅、噪音只有 8、解渴 42 饱食 34。
         它需要的一切条件恰好构成了「你终于活明白了」的证明。 */
      { id: 'slowSoup',    name:'老火靓汤',    lv: 3, need: { meat: 1, root: 2, dried: 1, water: 4 }, seasoning: 2, heater: 'slowOnly', pot: ['soup'], time: 180, satiety: 34, thirst: -42, loud: 8, odor: 3 },
      /* **玩家第一次真正意义上的「生产」而非「消耗」** —— 把 3 天必烂的叶菜变成 20 天的咸菜 */
      { id: 'makePickle',  name:'腌菜',        lv: 3, need: { leafy: 3, salt: 2 },                        heater: 'none',pot: [],               time: 60, satiety: 0,  thirst: 0,   loud: 0,  odor: 1, gives: 'pickle', outputCount: 3 },

      /* Lv4 */
      { id: 'threeFresh',  name:'三鲜锅',      lv: 4, need: { meat: 1, egg: 2, veg: 2, dried: 1, water: 3 }, seasoning: 3, heater: 'any', pot: ['soup'], time: 65, satiety: 44, thirst: -36, loud: 14, odor: 3 },
      { id: 'handNoodle',  name:'手擀面',      lv: 4, need: { flour: 1, water: 1 },                       heater: 'none',pot: [],               time: 30, satiety: 0,  thirst: 0,   loud: 6,  odor: 0, gives: 'driedNoodle', outputCount: 3 },
      { id: 'braisedPlate',name:'卤味拼盘',    lv: 4, need: { meat: 1, egg: 3, staranise: 1, water: 2 }, seasoning: 3, heater: 'any', pot: ['boil'],   time: 70, satiety: 46, thirst: -8,  loud: 18, odor: 3 },
      { id: 'zhajiang',    name:'炸酱面',      lv: 4, need: { driedNoodle: 1, canned: 1, onion: 1, soySauce: 1, oil: 1 }, heater: 'any', pot: ['fry'], time: 25, satiety: 48, thirst: -6, loud: 45, odor: 3 },

      /* Lv5 · **不追求饱食度最高，而是提供状态加成** */
      { id: 'gingerTea',   name:'热姜汤',      lv: 5, need: { ginger: 2, sugar: 1, water: 2 },            heater: 'any', pot: ['boil'],         time: 20, satiety: 8,  thirst: -26, loud: 12, odor: 1, buff: 'warm' },
      { id: 'strongTea',   name:'浓茶',        lv: 5, need: { tea: 1, water: 1 },                         heater: 'any', pot: ['boil'],         time: 6,  satiety: 2,  thirst: -18, loud: 15, odor: 0, buff: 'alert' },
      { id: 'blackCoffee', name:'黑咖啡',      lv: 5, need: { coffee: 1, water: 1 },                      heater: 'any', pot: ['boil'],         time: 6,  satiety: 3,  thirst: -14, loud: 15, odor: 0, buff: 'wired' },
      /* **全游戏唯一的生命值自然回复来源。** 在此之前受了伤只能靠绷带止血，生命值本身不会长回来。 */
      { id: 'tonicStew',   name:'高汤炖肉',    lv: 5, need: { meat: 2, dried: 2, water: 4 }, seasoning: 3, heater: 'slowOnly', pot: ['soup'],   time: 200, satiety: 50, thirst: -38, loud: 8, odor: 3, buff: 'tonic' },
      { id: 'bentoBox',    name:'能量便当',    lv: 5, need: { riceMeal: 1, meat: 1, egg: 1, veg: 1 }, seasoning: 2, heater: 'any', pot: ['fry'], time: 22, satiety: 42, thirst: -6, loud: 45, odor: 3, buff: 'portable' },
      { id: 'sugarWater',  name:'糖水',        lv: 5, need: { sugar: 2, water: 2 },                       heater: 'any', pot: ['boil'],         time: 8,  satiety: 10, thirst: -22, loud: 10, odor: 0, buff: 'sugarRush' }
    ],

    /* 食谱材料的显示名。食谱里用的是**类别键**（root/veg/dried 这种），
       因为「老火靓汤要两样根茎」比「必须是土豆」更符合真实做饭。
       界面上要把它翻回人话。 */
    ingredientNames: {
      water: '水', boiled: '开水', rice: '米', flour: '面粉', driedNoodle: '挂面',
      noodle: '方便面', egg: '鸡蛋', oil: '油', salt: '盐', sugar: '糖',
      soySauce: '酱油', ginger: '姜', garlic: '蒜', onion: '洋葱', tomato: '番茄罐头',
      mushroom: '香菇干', fungus: '木耳', beancurd: '腐竹', staranise: '八角',
      tea: '茶叶', coffee: '咖啡', potato: '土豆', radish: '萝卜', cabbage: '白菜',
      canned: '午餐肉', sausage: '火腿肠', pickle: '咸菜', meat: '肉', fish: '鱼',
      riceMeal: '米饭', congee: '白粥',
      root: '根茎类', veg: '蔬菜', dried: '干货', leafy: '叶菜'
    },

    /* Buff 效果（规格 8.3 Lv5）。**浓茶/咖啡的 rebound 是有意的** ——
       它让熬夜变成一笔明确的借贷，而不是免费的加速。 */
    foodBuffs: {
      warm:      { name: '保暖',   hours: 4, nightStaminaMul: 0.75, sickChanceMul: 0.5 },
      alert:     { name: '提神',   hours: 3, fatigueMul: 0.55, reboundFatigue: 12 },
      wired:     { name: '强提神', hours: 4, fatigueMul: 0.40, reboundFatigue: 20, shakeHours: 2, meleeWindupMul: 1.2 },
      tonic:     { name: '滋补',   hours: 8, healthPerHour: 1.5 },
      portable:  { name: '可携带', hours: 20 },
      sugarRush: { name: '急救',   hours: 0, instantStamina: 30 }
    },

    /* 烹饪熟练度（规格 第十二部分）。**只有尝试新东西才涨。** */
    cookingSkill: {
      xpFirstTime: 100, xpRepeat: [40, 15, 5, 0],
      xpGoldenWindow: 15, xpNewCookware: 50, xpNewHeater: 50,
      levels: [
        { xp: 0,    satiety: 0,    unlock: 0 },
        { xp: 150,  satiety: 0.08, unlock: 1 },
        { xp: 450,  satiety: 0.16, unlock: 2, goldenWindowMul: 1.5 },
        { xp: 950,  satiety: 0.24, unlock: 3, spoilageMul: 0.8 },
        { xp: 1700, satiety: 0.32, unlock: 4, timeMul: 0.85 },
        { xp: 2800, satiety: 0.40, unlock: 5, spoiledNoSickness: true }
      ]
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
      /* `[实测]` 开局口渴 30，不是 0。
         第一个教学目标是「嗓子干得厉害，先找点喝的」，而口渴 0 的话
         **这句话是假的，而且目标在第 0 秒就自动完成了** ——
         新手看到的第一件事是一个自己没做过的「✓ 完成」。
         30 = 8 个游戏小时，正好是「睡了一夜没喝水」；喝一瓶水（−24）降到 6，
         需求条肉眼可见地缩回去，这一下就把整条挤占机制讲清楚了。 */
      startThirst: 30,
      drinkGoalThirst: 20,       // 低于这个值 = 确实喝到了（口渴只会自己涨，不会自己降）
      /* `[实测]` 烹饪规格 0.1 的强制调整。原值下每天只需补 25 点饥饿，
         而一碗白饭就有 22 —— 食物完全不构成压力，整套烹饪系统失去存在理由。
         新值：每游戏日 饥饿 48 点 / 口渴 84 点 ≈ 2 顿正餐 + 1~2 次加餐 + 3.5 份饮水。 */
      thirstFullHours: 28,       // 口渴涨满（原 30）
      hungerFullHours: 50,       // 饥饿涨满（原 96）
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

    /* ── 手艺配方（主文档 10.5）────────────────────────
       **烹饪配方在上面的 `recipes` 表里，按烹饪熟练度解锁；这里是手艺（craft）的。**
       两者分开：做饭要炉子和锅，手艺只要工具和材料。 */
    craftRecipes: [
      { id: 'bandage',    name: '绷带',         need: '布 ×2',                skill: 0, unlock: 'textbook', note: '' },
      { id: 'plank',      name: '建材',         need: '木板/课桌 + 工具',      skill: 0, unlock: 'textbook', note: '封锁出入口要用' },
      { id: 'rainCatch',  name: '雨水收集器',   need: '容器 + 塑料布 + 建材', skill: 1, unlock: 'manual', note: '露天自动接雨' },
      { id: 'clock',      name: '闹钟',         need: '闹钟零件 ×2 + 电池',   skill: 2, unlock: 'manual', note: '' },
      { id: 'muffle',     name: '消音布',       need: '布 ×3',                skill: 2, unlock: 'manual', note: '静步 −15%' },
      { id: 'fixCircuit', name: '修复回路',     need: '电线 ×2 + 工具',       skill: 2, unlock: 'manual', note: '让烧坏的回路重新通电' },
      { id: 'reinforce',  name: '长柄武器加固', need: '武器 + 建材 + 工具',   skill: 3, unlock: 'manual', note: '' },
      { id: 'repairPart', name: '修理零件',     need: '废零件 ×3 + 工具',     skill: 3, unlock: 'manual', note: '' },
      { id: 'debuzz',     name: '拆掉蜂鸣器',   need: '微波炉 + 工具',        skill: 3, unlock: 'manual', note: '**消掉那声要命的「叮」**' },
      { id: 'workbench',  name: '自制工作台',   need: '建材 ×3 + 工具',       skill: 1, unlock: 'manual', note: '可放 2 台设备' }
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
