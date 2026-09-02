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
      globalMinThreshold: 8,       // Dijkstra 剪枝下限 = 全场最低听觉阈值（屏息玩家）
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
      lootSlow: 15,
      meleeHit: 55,
      playerHurt: 60,
      broadcast: 150,
      zombieGrowl: 55,             // 主文档 5.4：追击低吼
      crawlerBreath: 12,           // 主文档 5.2：蜷伏者呼吸声
      exhaustedBreath: 25,         // 主文档 3.3：体力耗尽的喘息
      zombieShuffle: 30,           // 丧尸未发现玩家时的拖行脚步声。
                                   // 这一条回答了主文档 13.1 待定问题 4：玩家能听见丧尸的常态动静。
                                   // 30 意味着屏息(阈值8)可听 11m、常态(阈值25)只有 2.5m ——
                                   // 屏息因此成为真正的侦查工具，而丧尸听见你走路只有 5m。
      jumpLand: 35                 // 文档外：跳跃落地。翻越沿用 windowClimb(30)
    },

    // ── 连接类型衰减表（声音规格 6.2）──────────────────
    // null 表示该类型没有这个状态（例如门洞没有 Closed）。
    portalAttenuation: {
      Doorway:  { Open: 0,  Closed: null, Broken: null, Blocked: 60 },
      WoodDoor: { Open: 5,  Closed: 45,   Broken: 8,    Blocked: 75 },
      SteelDoor:{ Open: 6,  Closed: 70,   Broken: 10,   Blocked: 95 },
      Window:   { Open: 8,  Closed: 40,   Broken: 6,    Blocked: 70 },
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
      player: 25,
      playerHoldBreath: 8,
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
        name: '游荡者', hp: 100, threshold: 10,
        speedWander: 1.0, speedChase: 3.2,
        visionRadius: 14, visionAngle: 110, eyeHeight: 1.6,
        // 主文档 13.1 待定问题 4：游荡者是否有常态呼吸声。默认 0（关闭），改成 12 可实测。
        breathLoudness: 0, breathInterval: 3.0,
        shuffleInterval: 1.1          // 游荡/调查时每隔多久发一次脚步
      },
      Crawler: {
        name: '蜷伏者', hp: 100, threshold: 6,
        speedWander: 1.0, speedChase: 3.2,
        visionRadius: 14, visionAngle: 110, eyeHeight: 1.6,
        riseDistance: 8,            // 声源在 8 米内才起身
        breathInterval: 2.5,        // 呼吸声间隔（文档未给频率，此值为实测占位）
        shuffleInterval: 1.1
      },
      Runner: {                     // 第 12 天后才出现，M0 不放置，仅保留定义
        name: '奔行者', hp: 60, threshold: 6,
        speedWander: 1.2, speedChase: 5.4,
        visionRadius: 18, visionAngle: 110, eyeHeight: 1.6, shuffleInterval: 0.8
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
      leanOffset: 0.55, leanAngle: 12,
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
      weightRatio: 0.0,             // M0 无背包，用调试面板模拟负重比 r
      weightLoudnessCoef: 0.5,      // 脚步响度 ×(1+0.5r)
      weightStaminaCoef: 0.8,       // 体力消耗 ×(1+0.8r)
      weightSpeedCoef: 0.25         // 奔跑速度 ×(1−0.25r)
    },

    // ── 交互（主文档 4.3）──────────────────────────────
    interact: {
      range: 2.2,
      doorSlowHoldSeconds: 2.5,
      doorCloseSlowHoldSeconds: 2.0,
      lootFastSeconds: 4, lootSlowSeconds: 9
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
      corridorD: 2.6, floorHeight: 3.2, wallThickness: 0.2,
      stairWellW: 6.0, stairWellD: 6.0,
      stairStepH: 0.2, stairStepD: 0.3, stairWidth: 2.4, stairSlabThickness: 0.45,
      spawnRoomFloor: 3,            // 0-based：第 4 层
      spawnRoomIndex: 1             // 402 = 4 楼第 2 间
    },

    // ── 调试 ──────────────────────────────────────────
    debug: {
      showSoundprintAlways: false,  // 非屏息时也显示声纹（仅调试用，正式规则见 10.1）
      soundprintLifetime: 1.6,
      logMaxEntries: 60
    }
  };

  // 深拷贝一份出厂值，调试面板「重置」用。
  C.ConfigDefaults = JSON.parse(JSON.stringify(C.Config));
})(typeof globalThis !== 'undefined' ? globalThis : this);
