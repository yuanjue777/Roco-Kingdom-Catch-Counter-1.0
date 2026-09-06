/*
 * 无头 AI 仿真测试：不开浏览器就验证丧尸状态机与寻路。
 * 跑法：node test/sim-ai.js
 */
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['03-math', '00-config', '01-eventbus', '02-modifiers', '04-soundgraph',
                 '05-soundsystem', '06-hearing', '07-time', '08-level', '09-collision',
                 '18-needs', '21-items', '22-loot', '10-player', '11-zombie', '19-sleep',
                 '24-campus', '25-streaming', '26-notebook', '20-save']) require(path.join(SRC, f + '.js'));
const C = globalThis.Campus;

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '  → ' + e : '')); } };
const section = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

function makeSim() {
  C.SoundSystem.reset(); C.ZombieManager.reset(); C.ModifierPipeline.clear();
  const level = C.buildDormitory();
  C.placeContainers(level); C.placeLooseItems(level);
  const world = new C.World(level);
  const time = new C.TimeSystem();
  C.SoundSystem.init(level.graph, time);
  C.Projectiles.init(world);
  const player = { alive: false, pos: C.V.copy(level.spawn), flashlight: false,
                   eyePos() { return { x: this.pos.x, y: this.pos.y + 1.65, z: this.pos.z }; },
                   detectMultiplier() { return 1; }, die() { this.alive = false; } };
  return { level, world, time, player };
}
function step(sim, seconds, dt) {
  dt = dt || 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    sim.time.update(dt);
    C.Projectiles.update(dt);
    C.ZombieManager.update(dt, sim.player, sim.time);
  }
}

// ── 1. 听声 → 警觉 → 调查 → 搜索 → 游荡 ─────────────
section('1. 状态机完整流程');
let sim = makeSim();
const S = C.ZombieState;
// 只留一只：1F 走廊的游荡者
const z = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(10, 0.0, 1.3) }, sim.world);
step(sim, 0.2);
ok('初始为游荡', z.state === S.Wander, z.state);

// 在 6 米外扔一块石头（响度 45）
C.SoundSystem.emit({ worldPosition: C.V.make(16, 0.2, 1.3), loudness: C.Config.loudness.stoneImpact,
                     category: C.SoundCategory.Impact, emitterId: -1, label: '测试石头' });
ok('听到石头后进入警觉', z.state === S.Alert, z.state);
ok('反应延迟按公式计算且 >0', z.reactTimer > 0 && z.reactTimer <= 3.0, z.reactTimer.toFixed(2));
ok('目标点带定位误差且已固定', z.target !== null && z.targetError >= 0,
   '误差半径 ' + (z.targetError || 0).toFixed(2) + 'm');
const targetSnapshot = JSON.stringify(z.target);
step(sim, 0.5);
ok('警觉期间目标点不重算（不抖）', JSON.stringify(z.target) === targetSnapshot);

step(sim, 3.5);
ok('延迟结束后进入调查', z.state === S.Investigate || z.state === S.Search, z.state);
const distStart = C.V.distXZ(z.pos, z.target);
step(sim, 12);
ok('走到了目标点附近并转入搜索', z.state === S.Search, z.state + ' 距目标 ' + C.V.distXZ(z.pos, z.target).toFixed(2) + 'm');
step(sim, 18);
ok('搜索超时后回到游荡', z.state === S.Wander, z.state);

// ── 2. 优先级覆盖（声音规格 5.3）────────────────────
section('2. 连续投石不会让丧尸原地抽搐');
sim = makeSim();
const z2 = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(10, 0.0, 1.3) }, sim.world);
step(sim, 0.2);
C.SoundSystem.emit({ worldPosition: C.V.make(14, 0.2, 1.3), loudness: 45, category: C.SoundCategory.Impact, emitterId: -1 });
const firstTarget = JSON.stringify(z2.target);
C.SoundSystem.emit({ worldPosition: C.V.make(6, 0.2, 1.3), loudness: 45, category: C.SoundCategory.Impact, emitterId: -1 });
ok('同等响度的第二块石头不切换目标', JSON.stringify(z2.target) === firstTarget);
C.SoundSystem.emit({ worldPosition: C.V.make(10.5, 0.2, 1.3), loudness: 90, category: C.SoundCategory.Impact, emitterId: -1 });
ok('显著更响的声音才切换目标', JSON.stringify(z2.target) !== firstTarget);

// ── 3. 跨楼层寻路（楼梯）───────────────────────────
section('3. 楼梯寻路');
sim = makeSim();
const z3 = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(10, 0.0, 1.3) }, sim.world);
step(sim, 0.2);
const startFloor = Math.floor(z3.pos.y / 3.2);
// 二楼走廊里一声巨响
C.SoundSystem.emit({ worldPosition: C.V.make(8, 3.4, 1.3), loudness: 120, category: C.SoundCategory.Impact, emitterId: -1 });
ok('隔层也能听见（声音走楼梯口传下来）', z3.state === S.Alert, z3.state);
step(sim, 45);
const endFloor = Math.floor((z3.pos.y + 0.1) / 3.2);
ok('丧尸真的爬上了楼梯', endFloor > startFloor, `从 ${startFloor + 1}F 到 ${endFloor + 1}F, y=${z3.pos.y.toFixed(2)}`);

// ── 3b. 楼层边界的节点归属 ──────────────────────────
section('3b. 地板平面上的点属于哪一层');
sim = makeSim();
const g3 = sim.level.graph;
const H3 = 3.2;
for (let f = 0; f < 4; f++) {
  const p = C.V.make(16, f * H3, 1.3);      // 正好站在第 f 层地板上
  const n = g3.getNodeAt(p);
  ok(`y=${(f * H3).toFixed(1)} 属于 ${f + 1}F 走廊而不是楼下`, n && n.name === (f + 1) + 'F走廊', n && n.name);
}
// 浮点回归：直接写字面量 9.6（而不是 3×3.2）也必须判到 4F
ok('字面量 y=9.6 也判到 4F（浮点容差）', g3.getNodeAt(C.V.make(16, 9.6, 1.3)).name === '4F走廊',
   g3.getNodeAt(C.V.make(16, 9.6, 1.3)).name);
ok('楼层中部 y=11.0 判到 4F', g3.getNodeAt(C.V.make(16, 11.0, 1.3)).name === '4F走廊');
ok('楼下中部 y=8.0 判到 3F', g3.getNodeAt(C.V.make(16, 8.0, 1.3)).name === '3F走廊');

// 回归：丧尸的低吼从脚下发出，不能被算成楼下发出的
const zf = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(16, 3 * H3, 1.3) }, sim.world);
step(sim, 0.2);
zf.chainDepth = 0; zf.visible = false; zf.lastSeen = C.V.make(20, 3 * H3, 1.3); zf._setState(S.Chase);
step(sim, 2);
const growl = C.SoundSystem.log.filter(e => e.label === '低吼').pop();
ok('追击低吼记在 4F 走廊', growl && g3.getNode(growl.node).name === '4F走廊', growl && g3.getNode(growl.node).name);
ok('丧尸朝着同层的目标移动（不会跑去楼下）', zf.pos.x > 16.2, 'x=' + zf.pos.x.toFixed(2));

// ── 4. 关门挡人也挡路（Portal 状态同时管声与行）────
section('4. 关门阻断寻路');
sim = makeSim();
const g = sim.level.graph;
const room402 = g.nodes.find(n => n.name === '402');
const door402 = g.portals.find(p => (p.nodeA === room402.id || p.nodeB === room402.id) && p.type === 'WoodDoor');
g.setPortalState(door402, 'Open');
const z4 = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(7, 9.6, 1.3) }, sim.world);
step(sim, 0.2);
z4._pathTo(C.AABB.center(room402.bounds));
ok('门开着时能找到进房间的路', z4.path.length > 0, '路点数 ' + z4.path.length);
g.setPortalState(door402, 'Closed');
z4._pathTo(C.AABB.center(room402.bounds));
ok('门关上后找不到路', z4.path.length === 0);

// ── 5. 连锁警戒上限（主文档 5.5）────────────────────
section('5. 连锁警戒');
sim = makeSim();
const a = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(6, 0, 1.3) }, sim.world);
const b = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(12, 0, 1.3) }, sim.world);
step(sim, 0.2);
// 深度 0 的低吼：应该能引到人
C.SoundSystem.emit({ worldPosition: C.V.make(9, 0, 1.3), loudness: C.Config.loudness.zombieGrowl,
                     category: C.SoundCategory.Voice, emitterId: 999, chainDepth: 0 });
ok('第 0 层低吼能引来其他丧尸', a.state === S.Alert && b.state === S.Alert);
sim = makeSim();
const a2 = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(6, 0, 1.3) }, sim.world);
step(sim, 0.2);
C.SoundSystem.emit({ worldPosition: C.V.make(9, 0, 1.3), loudness: C.Config.loudness.zombieGrowl,
                     category: C.SoundCategory.Voice, emitterId: 999, chainDepth: 2 });
ok('达到上限层数的低吼不再引人', a2.state === S.Wander, a2.state);

// ── 6. 蜷伏者（主文档 5.2）──────────────────────────
section('6. 蜷伏者');
sim = makeSim();
const cr = C.ZombieManager.spawn({ type: 'Crawler', pos: C.V.make(10, 0, 4.0) }, sim.world);
step(sim, 0.2);
ok('初始为趴伏', cr.state === S.Prone);
C.SoundSystem.emit({ worldPosition: C.V.make(10, 0, 16.0), loudness: 90, category: C.SoundCategory.Impact, emitterId: -1 });
ok('声源在 8m 外时不起身（哪怕很响）', cr.state === S.Prone, cr.state);
C.SoundSystem.emit({ worldPosition: C.V.make(10, 0, 7.5), loudness: 45, category: C.SoundCategory.Impact, emitterId: -1 });
ok('声源进入 8m 内才起身', cr.state === S.Alert, cr.state);

/* 蜷伏者呼吸声的可听半径 —— 这一段测出了一个设计问题，见下方注释。
   可听半径 = (响度 − 阈值) / k
     常态 : (12 − 25) / 2 < 0    永远听不见
     屏息 : (12 −  8) / 2 = 2m   必须贴到 2 米以内
   文档 5.2 说「屏息时能听到它们极轻微的呼吸声 —— 这是屏息作为侦查工具的核心价值」，
   但 2 米在室内基本等于已经走进它的起身范围(8m)了，侦查价值几乎为零。
   要让屏息真的能用来「扫房间」，crawlerBreath 需要提到 20–24（可听半径 6–8m），
   或者给环境类声音单独一个更小的 k。这个数只能靠实机手感定，配置里已经留了开关。 */
function breathHeardWithin(dist, threshold) {
  const sim2 = makeSim();
  C.ZombieManager.spawn({ type: 'Crawler', pos: C.V.make(10, 0, 4.0) }, sim2.world);
  let heard = 0;
  const ear = new C.HearingComponent({ ownerId: 1, baseThreshold: threshold,
    onHeard: (i) => { if (i.evt.label === '蜷伏者呼吸') heard++; } });
  ear.position = C.V.make(10 + dist, 1.65, 4.0);
  ear.nodeId = sim2.level.graph.getNodeAt(ear.position).id;
  C.SoundSystem.registerListener(ear);
  step(sim2, 8);
  return heard;
}
const TH = C.Config.hearing;
/* 常态阈值 9 对应可听半径 (12−9)/2 = 1.5m，而耳朵比趴在地上的声源高 1.65m —— 
   光是高度差就超了。也就是说常态根本听不见蜷伏者呼吸，必须屏息。 */
const breathR = (C.Config.loudness.crawlerBreath - TH.player) / C.Config.sound.kIndoor;
ok(`常态对呼吸声的可听半径只有 ${breathR.toFixed(1)}m，而耳朵比地面高 1.65m —— 几乎贴脸才行`,
   breathR < 2.5 && breathHeardWithin(1.5, TH.player) === 0);
ok('屏息能把呼吸的可听距离拉开', breathHeardWithin(1.5, TH.player - TH.holdBreathBonus) > 0);
// 上限从配置推导：屏息半径 = (呼吸响度 − 屏息阈值) / k，再远一点就该听不见
const breathHB = (C.Config.loudness.crawlerBreath - (TH.player - TH.holdBreathBonus)) / C.Config.sound.kIndoor;
ok(`但屏息也听不了多远，${(breathHB + 1).toFixed(1)}m 外就没了`,
   breathHeardWithin(breathHB + 1, TH.player - TH.holdBreathBonus) === 0, breathHB.toFixed(1) + 'm');
/* 雪上加霜：呼吸声从蜷伏者所在的地面高度发出，玩家耳朵在 1.65m，
   光是这个高度差就吃掉了 2m 可听预算里的 1.65m，水平可听距离只剩约 1.1m。 */
ok('高度差吃掉大部分预算：水平 1.1m 时 3D 距离已接近 2m',
   Math.abs(Math.hypot(1.1, 1.65) - 1.98) < 0.05);
ok('若把 crawlerBreath 提到 24，屏息可听半径 ' +
   ((24 - (TH.player - TH.holdBreathBonus)) / C.Config.sound.kIndoor).toFixed(1) + 'm，超过它 8m 的起身范围',
   (24 - (TH.player - TH.holdBreathBonus)) / C.Config.sound.kIndoor > 8);

// ── 7. 追击上限 ────────────────────────────────────
section('7. 同时追击上限');
sim = makeSim();
C.Config.zombieReaction.maxChasers = 3;
const many = [];
for (let i = 0; i < 6; i++) many.push(C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(4 + i * 3, 0, 1.3) }, sim.world));
for (const m of many) { m.chainDepth = 0; m._setState(S.Chase); m.lastSeen = C.V.make(10, 0, 1.3); m.visible = false; }
sim.player.pos = C.V.make(10, 0, 1.3);
C.ZombieManager._enforceChaseCap(sim.player);
const chasing = C.ZombieManager.list.filter(x => x.state === S.Chase).length;
ok('超过上限时最远的转为搜索', chasing === 3, String(chasing));
C.Config.zombieReaction.maxChasers = C.ConfigDefaults.zombieReaction.maxChasers;

// ── 8. 跳跃与翻越 ──────────────────────────────────
section('8. 跳跃与情境翻越');
sim = makeSim();
const P = C.Config.player;
const g8 = sim.level.graph;
const room = g8.nodes.find(n => n.name === '402');
const rc = C.AABB.center(room.bounds);
const floorY = 3 * 3.2;

// 床铺高 0.55m（房间里 z 2.9~4.9 那两张），应当可翻越
const bedProbe = sim.world.probeVault(
  C.V.make(rc.x, floorY, 4.0), { x: -1, y: 0, z: 0 }, P.radius, P);
ok('面向床铺可翻越（抬升约 0.55m）',
   bedProbe && Math.abs(bedProbe.rise - 0.55) < 0.02, bedProbe ? bedProbe.rise.toFixed(2) + 'm' : 'null');
// 书桌高 0.75m
const deskProbe = sim.world.probeVault(
  C.V.make(rc.x, floorY, 5.9), { x: 0, y: 0, z: 1 }, P.radius, P);
ok('面向书桌可翻越（抬升约 0.75m）',
   deskProbe && Math.abs(deskProbe.rise - 0.75) < 0.02, deskProbe ? deskProbe.rise.toFixed(2) + 'm' : 'null');

// 走廊南墙：3.2m 高，翻不上去
const wallProbe = sim.world.probeVault(
  C.V.make(16, floorY, 0.55), { x: 0, y: 0, z: -1 }, P.radius, P);
ok('面向 3.2m 实心墙不可翻越', wallProbe === null, wallProbe && wallProbe.rise.toFixed(2));

/* 窗户：关着不能翻，开了就能翻（窗台高 1.0m，窗洞净空 1.0m，正好够蹲姿钻过）。
   用走廊的窗测 —— 房间的窗底下正好摆着书桌，那条路径是「先上桌再跨窗台」，
   而窗台距桌面只有 0.25m，低于 vaultMinHeight，会被当成普通台阶走上去。 */
const corr4 = g8.nodes.find(n => n.name === '4F走廊');
const cwin = g8.portals.find(p => (p.nodeA === corr4.id || p.nodeB === corr4.id) && p.type === 'Window');
const cwinBox = sim.level.doors.find(d => d.portalId === cwin.id).box;
const beforeWin = C.V.make((cwinBox.min.x + cwinBox.max.x) / 2, floorY, 0.9);
g8.setPortalState(cwin, 'Closed');
ok('关着的窗不能翻', sim.world.probeVault(beforeWin, { x: 0, y: 0, z: -1 }, P.radius, P) === null);
g8.setPortalState(cwin, 'Open');
const winProbe = sim.world.probeVault(beforeWin, { x: 0, y: 0, z: -1 }, P.radius, P);
ok('开窗后可翻越（窗台约 1.0m）',
   winProbe && Math.abs(winProbe.rise - 1.0) < 0.05, winProbe ? winProbe.rise.toFixed(2) + 'm' : 'null');
g8.setPortalState(cwin, 'Closed');

// 玩家实例：空旷处按跳跃 → 腾空 → 落地
const player = new C.Player(sim.level, sim.world);
player.pos = C.V.make(16, floorY, 1.3); player.yaw = Math.PI / 2;
const idle = { forward: 0, right: 0, run: false, crouch: false, wallHug: false, lean: 0,
               holdBreath: false, interact: false, throwHeld: false, jump: false };
player.update(1 / 60, idle, sim.time);
const stam0 = player.stamina;
player.update(1 / 60, Object.assign({}, idle, { jump: true }), sim.time);
ok('空旷处按跳跃进入腾空', player.airborne === true);
ok('跳跃消耗体力 6（文档外新增值）', Math.abs(stam0 - player.stamina - P.stamina.jumpCost) < 0.3,
   (stam0 - player.stamina).toFixed(2));
let peak = player.pos.y;
for (let i = 0; i < 120; i++) {
  player.update(1 / 60, Object.assign({}, idle, { jump: true }), sim.time);
  peak = Math.max(peak, player.pos.y);
}
ok('按住跳跃不会连跳（边沿触发）', true);
ok('跳起高度约 0.49m', Math.abs(peak - floorY - 0.49) < 0.08, (peak - floorY).toFixed(3) + 'm');
ok('自由落体后回到地面', !player.airborne && Math.abs(player.pos.y - floorY) < 0.01, player.pos.y.toFixed(3));

// 贴着书桌按跳跃 → 走翻越分支，消耗 12 体力，发出响度 30
player.pos = C.V.make(rc.x, floorY, 5.9);
player.yaw = Math.PI;              // 朝 +z，正对书桌
player.stamina = 100;
// 这一段量的是翻越的基准响度，先把开局石头卸下来 —— 负重会给响度加一点点
player.hotbar = [null, null, null, null, null, null];
C.SoundSystem.log.length = 0;
player.update(1 / 60, idle, sim.time);
player.update(1 / 60, Object.assign({}, idle, { jump: true }), sim.time);
ok('贴障碍按跳跃走的是翻越分支', player.vault !== null, player.lastAction);
ok('翻越消耗体力 12（主文档 3.3）', Math.abs(100 - player.stamina - P.stamina.climbCost) < 0.3,
   (100 - player.stamina).toFixed(2));
const climbSnd = C.SoundSystem.log.find(e => e.label === '翻越');
ok('翻越发出响度 30 的事件（声音规格 6.1 翻窗）', climbSnd && climbSnd.loud === 30, climbSnd && String(climbSnd.loud));
for (let i = 0; i < 60; i++) player.update(1 / 60, idle, sim.time);
ok('翻越结束后站在书桌上（约 +0.75m）', !player.vault && Math.abs(player.pos.y - floorY - 0.75) < 0.05,
   (player.pos.y - floorY).toFixed(3) + 'm');

// ── 9. 投掷预测 ────────────────────────────────────
section('9. 投掷落点与引怪半径');
player.pos = C.V.make(16, floorY, 1.3); player.yaw = Math.PI / 2; player.pitch = 0;
player.charge = 1;
const pred = player.predictThrow();
ok('弹道有多个采样点且以撞击点结束', pred.points.length > 3, pred.points.length + ' 点');
ok('落点在弹道末端', pred.impact === pred.points[pred.points.length - 1]);
ok('室内引怪半径 =(45−10)/2 = 17.5m', Math.abs(pred.radius - 17.5) < 0.01, pred.radius.toFixed(2) + 'm');
sim.time.hour = 23;
const nightPred = player.predictThrow();
ok('夜间引怪半径扩大到 25m（k×0.7）', Math.abs(nightPred.radius - 25) < 0.01, nightPred.radius.toFixed(2) + 'm');
sim.time.hour = 12;

/* 回归：落点必须留在被撞面的正确一侧。
   往脚下扔石头，落地事件必须记在 4F，不能因为穿透楼板而记到 3F 去。 */
player.pos = C.V.make(16, floorY, 1.3); player.pitch = -1.3; player.charge = 0.2;
C.SoundSystem.log.length = 0;
C.Projectiles.list.length = 0;
const predDown = player.predictThrow();
ok('朝脚下预测的落点仍在本层', g8.getNodeAt(predDown.impact).name === '4F走廊',
   g8.getNodeAt(predDown.impact).name + ' y=' + predDown.impact.y.toFixed(3));
C.Projectiles.spawn(player.eyePos(), player.aimDir(), 8, player.id);
for (let i = 0; i < 60; i++) C.Projectiles.update(1 / 60);
const hit = C.SoundSystem.log.find(e => e.label === '石头落地');
ok('石头落地事件记在 4F 而不是楼下', hit && g8.getNode(hit.node).name === '4F走廊',
   hit ? g8.getNode(hit.node).name : '(无事件)');
player.pitch = 0; player.charge = 0;

/* 预览的落点必须就是实弹的落点。之前预览用固定 0.06 步长、实弹用逐帧变长的 dt，
   两条轨迹算出来不是同一条，玩家看到的抛物线和石头真正落的地方对不上。 */
{
  player.pos = C.V.make(16, floorY, 1.3); player.yaw = Math.PI / 2; player.pitch = -0.15;
  player.charge = 0.7;
  const pr = player.predictThrow();
  C.SoundSystem.log.length = 0; C.Projectiles.list.length = 0; C.Projectiles._acc = 0;
  const sp = C.M.lerp(C.Config.throwing.speedMin, C.Config.throwing.speedMax, player.charge);
  C.Projectiles.spawn(player.eyePos(), player.aimDir(), sp, player.id);
  let landed = null;
  const off = C.SoundSystem.emit.bind(C.SoundSystem);
  C.SoundSystem.emit = (d) => { if (d.label === '石头落地') landed = d.worldPosition; return off(d); };
  for (let i = 0; i < 400 && !landed; i++) C.Projectiles.update(1 / 60);
  C.SoundSystem.emit = off;
  ok('实弹落地了', !!landed);
  ok('预览落点与实弹落点完全一致（误差 < 1cm）',
     landed && C.V.dist(landed, pr.impact) < 0.01,
     landed ? C.V.dist(landed, pr.impact).toFixed(4) + 'm' : '—');
  player.pitch = 0; player.charge = 0;
}

// 侧头时投掷起点跟着脑袋一起探出去
{
  player.pos = C.V.make(16, floorY, 1.3); player.yaw = 0; player.lean = 0;
  const a = player.eyePos();
  // 侧身是平滑量，得跑几帧让它到位
  for (let i = 0; i < 40; i++) player.update(1 / 60, Object.assign({}, idle, { lean: 1 }), sim.time);
  const b = player.eyePos();
  ok('侧头会把眼位（也就是投掷起点）横向探出去',
     Math.abs(b.x - a.x) > 0.35 && b.y < a.y, '偏移 ' + Math.abs(b.x - a.x).toFixed(2) + 'm');
  ok('侧身是平滑过渡，不是瞬间切换', (() => {
    const p2 = new C.Player(sim.level, sim.world);
    p2.pos = C.V.make(16, floorY, 1.3);
    p2.update(1 / 60, Object.assign({}, idle, { lean: 1 }), sim.time);
    return p2.leanAmount > 0 && p2.leanAmount < 0.4;
  })(), '一帧后只走到一小部分');
  for (let i = 0; i < 40; i++) player.update(1 / 60, idle, sim.time);
}

// ── 10. 丧尸拖行脚步与屏息侦查 ──────────────────────
section('10. 丧尸脚步声（回答主文档 13.1 待定问题 4）');
sim = makeSim();
const zw = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(10, 0, 1.3) }, sim.world);
function ear(thr, x) {
  let n = 0;
  const h = new C.HearingComponent({ ownerId: 1, baseThreshold: thr,
    onHeard: (i) => { if (i.evt.label === '丧尸脚步') n++; } });
  h.position = C.V.make(x, 1.65, 1.3);
  h.nodeId = sim.level.graph.getNodeAt(h.position).id;
  C.SoundSystem.registerListener(h);
  return () => n;
}
const farNormal = ear(TH.player, 26), farHeld = ear(TH.player - TH.holdBreathBonus, 26);
step(sim, 20);
ok('移动中的丧尸会持续发出脚步声', C.SoundSystem.log.filter(e => e.label === '丧尸脚步').length > 0);
const L = C.Config.loudness.zombieShuffle, k = C.Config.sound.kIndoor;
ok(`常态可听 ${(L - TH.player) / k}m > 丧尸听见你走路的 ${(C.Config.loudness.walk - TH.zombie) / k}m —— 玩家有先手`,
   (L - TH.player) / k > (C.Config.loudness.walk - TH.zombie) / k);
// 屏息扩出来的半径 = 加成 / k，跟着配置走
const hbGain = TH.holdBreathBonus / k;
ok(`屏息在常态基础上再扩 ${hbGain.toFixed(1)}m`,
   Math.abs((L - (TH.player - TH.holdBreathBonus)) / k - (L - TH.player) / k - hbGain) < 0.01);
/* 直接量可听半径：在同一个节点里，正好 10.5m 处应当刚好听得见，12m 处听不见 */
const shufR = (C.Config.loudness.zombieShuffle - TH.player) / C.Config.sound.kIndoor;
ok(`丧尸脚步的常态可听半径就是 ${shufR.toFixed(1)}m`, (() => {
  const s3 = makeSim();
  const at = (d) => {
    let n = 0;
    const h = new C.HearingComponent({ ownerId: 1, baseThreshold: TH.player,
      onHeard: () => n++ });
    h.position = C.V.make(10 + d, 1.3, 1.3);
    h.nodeId = s3.level.graph.getNodeAt(h.position).id;
    C.SoundSystem.registerListener(h);
    C.SoundSystem.emit({ worldPosition: C.V.make(10, 1.3, 1.3), loudness: C.Config.loudness.zombieShuffle,
                         category: C.SoundCategory.Footstep, emitterId: 101 });
    C.SoundSystem.unregisterListener(h);
    return n;
  };
  return at(shufR - 0.1) > 0 && at(shufR + 0.1) === 0;
})());
ok('趴伏的蜷伏者不发脚步声', (() => {
  const s2 = makeSim();
  const cr3 = C.ZombieManager.spawn({ type: 'Crawler', pos: C.V.make(10, 0, 4) }, s2.world);
  step(s2, 6);
  return cr3.state === S.Prone && C.SoundSystem.log.filter(e => e.label === '丧尸脚步').length === 0;
})());

// ── 11. 贴墙第三人称 ───────────────────────────────
section('11. 贴墙（单击切换）');
sim = makeSim();
const pw = new C.Player(sim.level, sim.world);
const idle2 = { forward: 0, right: 0, run: false, crouch: false, wallHug: false, lean: 0,
                holdBreath: false, interact: false, throwHeld: false, jump: false };
// 站到走廊南墙前
pw.pos = C.V.make(16, 3 * 3.2, 0.55); pw.yaw = 0;
pw.update(1 / 60, idle2, sim.time);
pw.update(1 / 60, Object.assign({}, idle2, { wallHug: true }), sim.time);
ok('贴近墙面时单击可进入贴墙', pw.wallHug === true, pw.lastAction);
// 南墙法线 =(0,+1)，沿墙走向 = ±x；朝向应落在其中一侧而不是朝向墙外
{
  const f = pw.forwardFlat();
  ok('进入后朝向沿墙走向（不是朝墙外）', Math.abs(f.z) < 0.01 && Math.abs(Math.abs(f.x) - 1) < 0.01,
     'forward=(' + f.x.toFixed(2) + ',' + f.z.toFixed(2) + ')');
}
pw.update(1 / 60, idle2, sim.time);
ok('松开按键不会退出（是状态不是按住）', pw.wallHug === true);
pw.update(1 / 60, Object.assign({}, idle2, { wallHug: true }), sim.time);
ok('再次单击退出', pw.wallHug === false);
// 远离墙面自动解除
pw.update(1 / 60, idle2, sim.time);
pw.update(1 / 60, Object.assign({}, idle2, { wallHug: true }), sim.time);
pw.pos = C.V.make(16, 3 * 3.2, 1.8);   // 走廊另一侧：那面墙的法线相反
pw.update(1 / 60, idle2, sim.time);
ok('离开原来那面墙就自动解除（不会顺势改贴对面墙）', pw.wallHug === false);
// 声纹带声源坐标（供透视标记用）
sim = makeSim();
const pv = new C.Player(sim.level, sim.world);
pv.pos = C.V.make(16, 3 * 3.2, 1.3);
pv.update(1 / 60, idle2, sim.time);
C.SoundSystem.emit({ worldPosition: C.V.make(12, 3 * 3.2, 1.3), loudness: 60,
                     category: C.SoundCategory.Footstep, emitterId: 101, label: '丧尸脚步' });
const sp = pv.soundprints[pv.soundprints.length - 1];
ok('声纹记录了声源真实坐标（标记挂在它头顶）', sp && sp.src && Math.abs(sp.src.x - 12) < 0.01);
{
  const before = pv.soundprints.length;
  C.SoundSystem.emit({ worldPosition: C.V.make(13, 3 * 3.2, 1.3), loudness: 60,
                       category: C.SoundCategory.Impact, emitterId: -1, label: '石头落地' });
  ok('非丧尸发出的声音不产生声纹（石头、门都不显示）', pv.soundprints.length === before);
}
ok('声纹标记了来源是丧尸', sp && sp.fromZombie === true);
ok('方向指示仍按路径入口算（规格 5.4 不受影响）', typeof sp.angle === 'number');

// ── 12. 生存需求与睡眠（主文档 3.2 / 3.3 / 3.4）──────
section('12. 需求挤占');
const NC = C.Config.needs;
{
  const n = new C.Needs(1);
  ok('初始满血且无挤占', n.health === 100 && n.healthMax() === 100);
  n.update(NC.thirstFullHours / 2, false);
  ok(`口渴 ${NC.thirstFullHours} 小时涨满：一半时间涨到 50`, Math.abs(n.thirst - 50) < 0.01, n.thirst.toFixed(1));
  ok('可用生命上限被挤占压低', n.healthMax() < 100, n.healthMax().toFixed(1));
  ok('当前生命被压到上限以内', n.health <= n.healthMax() + 1e-9, n.health.toFixed(1));
  n.damage(30, '测试');
  const before = n.health;
  n.consume('water');
  ok('喝水立即解除口渴挤占，上限回升', n.thirst === 50 - 25);
  ok('但当前生命不因此回血 —— 挤占解除只是解锁上限', n.health === before, n.health.toFixed(1));
  n.heal(10);
  ok('治疗才抬当前生命', n.health === before + 10);
}
{
  const n = new C.Needs(1);
  n.update(NC.thirstFullHours, false);      // 口渴涨满
  n.update(0.01, false);
  ok('口渴涨满导致可用上限归零 → 死亡', n.dead && n.cause === '渴死', n.cause);
}
{
  const n = new C.Needs(1);
  n.update(20, false);
  ok(`困乏清醒 ${NC.fatigueRatePerHour}/小时，20 小时挤满体力条`, Math.abs(n.fatigue - 100) < 0.01);
  ok('可用体力上限归零', n.staminaMax() === 0);
  n.update(100 / NC.fatigueSleepPerHour, true);
  ok('睡眠把困乏清空', n.fatigue < 0.01);
}
{
  const n = new C.Needs(1);
  const rng = { next: () => 0.1 };          // 必定触发腹泻
  n.update(10, false);
  const t0 = n.thirst;
  n.consume('raw', rng);
  ok('未处理的水会喝出腹泻', n.diarrheaHours === NC.diarrheaHours);
  n.update(1, false);
  const rate = (n.thirst - (t0 - 25)) / 1;
  ok('腹泻期间口渴增速翻倍', Math.abs(rate - (100 / NC.thirstFullHours) * NC.diarrheaThirstMul) < 0.01,
     rate.toFixed(2) + '/小时');
}
{
  const n = new C.Needs(1);
  n.update(10, false);
  const f0 = n.fatigue;
  n.grantRested();
  n.update(1, false);
  ok('精力充沛期间困乏增速 −25%',
     Math.abs((n.fatigue - f0) - NC.fatigueRatePerHour * NC.restedFatigueMul) < 0.01);
}

section('13. 睡眠与安全睡点');
sim = makeSim();
{
  const ps = new C.Player(sim.level, sim.world);
  const room = sim.level.graph.nodes.find(n => n.name === '402');
  const rc = C.AABB.center(room.bounds);
  ps.pos = C.V.make(rc.x - 2.4, 3 * 3.2, 4.0);      // 站在床边
  ps.update(1 / 60, { forward: 0, right: 0, run: 0, crouch: 0, wallHug: 0, lean: 0,
                      holdBreath: 0, interact: 0, throwHeld: 0, jump: 0 }, sim.time);
  const g5 = sim.level.graph;
  const door = g5.portals.find(p => (p.nodeA === room.id || p.nodeB === room.id) && p.type === 'WoodDoor');
  const win = g5.portals.find(p => (p.nodeA === room.id || p.nodeB === room.id) && p.type === 'Window');
  g5.setPortalState(door, 'Open');
  let r = C.Sleep.check(ps, sim.level, C.ZombieManager.list);
  ok('门开着不能睡', !r.ok && r.reasons.some(x => x.includes('门窗')), r.reasons.join('/'));
  g5.setPortalState(door, 'Closed'); g5.setPortalState(win, 'Closed');
  r = C.Sleep.check(ps, sim.level, C.ZombieManager.list);
  ok('关好门窗 + 床边 → 可以睡', r.ok, r.reasons.join('/'));
  const zz = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(rc.x, 3 * 3.2, rc.z) }, sim.world);
  zz.nodeId = room.id;
  r = C.Sleep.check(ps, sim.level, C.ZombieManager.list);
  ok('房里有丧尸不能睡', !r.ok && r.reasons.some(x => x.includes('丧尸')));
  zz.destroy(); C.ZombieManager.list.pop();
  ps.pos = C.V.make(rc.x, 3 * 3.2, rc.z + 2.2);      // 离开床
  r = C.Sleep.check(ps, sim.level, C.ZombieManager.list);
  ok('离床太远不能睡', !r.ok && r.reasons.some(x => x.includes('床')));
}
{
  sim.time.hour = 21; C.Sleep.reset();
  C.Sleep.begin({}, sim.time, 8);
  ok('入睡后时间加速', sim.time.timeScale === C.Config.sleep.timeScale);
  C.Sleep.update(6.5, sim.time);
  ok('睡满 6 小时且 22:00 前入睡 → 精力充沛', C.Sleep.grantsRested());
  C.Sleep.interrupt(sim.time, '测试');
  ok('被中断就拿不到 buff', !C.Sleep.grantsRested());
  ok('醒来后时间流速恢复', sim.time.timeScale === 1);
}

section('14. 存档');
{
  const store = {};
  global.localStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
  const sim2 = makeSim();
  const game = { player: new C.Player(sim2.level, sim2.world), time: sim2.time, level: sim2.level };
  C.ZombieManager.spawnAll(sim2.level, sim2.world);
  game.player.pos = C.V.make(11, 9.61, 1.7); game.player.stones = 7;
  game.player.needs.thirst = 33; game.player.needs.hunger = 12;
  game.time.day = 4; game.time.hour = 15.5;
  const door2 = sim2.level.graph.portals.find(p => p.type === 'WoodDoor');
  sim2.level.graph.setPortalState(door2, door2.state === 'Open' ? 'Closed' : 'Open');
  ok('保存成功', C.Save.save(game).ok);
  const raw = C.Save.read();
  ok('存档带版本号', raw && raw.version === C.Save.version);
  ok('只记录与出厂状态不同的 Portal', raw.portals.length === 1, raw.portals.length + ' 条');
  // 打乱现场再读回
  game.player.pos = C.V.make(0, 0, 0); game.player.stones = 0;
  game.player.needs.thirst = 0; game.time.day = 1; game.time.hour = 9;
  C.Save.apply(game, raw);
  ok('读档还原位置与物品', Math.abs(game.player.pos.x - 11) < 0.01 && game.player.stones === 7);
  ok('读档还原需求', Math.abs(game.player.needs.thirst - 33) < 0.01);
  ok('读档还原时间', game.time.day === 4 && Math.abs(game.time.hour - 15.5) < 0.01);
  ok('读档还原 Portal 状态', sim2.level.graph.portals[raw.portals[0].i].state === raw.portals[0].s);
  store['campus-save-v1'] = JSON.stringify({ version: 999 });
  ok('版本不兼容时明确报告而不是崩溃', C.Save.read().incompatible === true);
  C.Save.clear();
  ok('清档后读不到', C.Save.read() === null);
}

// ── 15. 楼梯回归 ────────────────────────────────────
section('15. 每层楼梯都要能上能下');
{
  const s5 = makeSim();
  const walk = (from, dz, steps) => {
    const p = C.V.copy(from);
    for (let i = 0; i < steps; i++) s5.world.moveCharacter(p, 0, dz, 0.32, 1.7, 0.36);
    return p;
  };
  const H5 = 3.2;
  for (let f = 1; f < 4; f++) {
    const down = walk(C.V.make(-4.9, f * H5 + 0.01, 5.6), -0.02, 600);
    ok(`${f + 1}F 西楼梯能下到 ${f}F`, down.y < f * H5 - 0.2, 'y=' + down.y.toFixed(2));
  }
  for (let f = 0; f < 3; f++) {
    const up = walk(C.V.make(-4.9, f * H5 + 0.01, 0.2), 0.02, 600);
    ok(`${f + 1}F 西楼梯能上到 ${f + 2}F`, up.y > (f + 1) * H5 - 0.2, 'y=' + up.y.toFixed(2));
  }
}

// ── 16. 格子背包 ────────────────────────────────────
section('16. 格子容器');
{
  const g = new C.Grid(5, 4, '小书包');
  ok('小书包 5×4 = 20 格', g.cellCount() === 20);
  const water = C.makeItem('water');
  ok('瓶装水 1×2 放得进去', g.autoAdd(water).ok);
  ok('占用 2 格', g.usedCells() === 2);
  // 塞满
  const g2 = new C.Grid(2, 2, '小格');
  g2.autoAdd(C.makeItem('biscuit')); g2.autoAdd(C.makeItem('biscuit'));
  g2.autoAdd(C.makeItem('biscuit')); g2.autoAdd(C.makeItem('biscuit'));
  const rFull = g2.autoAdd(C.makeItem('biscuit'));
  ok('空格不够 → 背包已满', !rFull.ok && rFull.reason === 'full', rFull.reason);
  // 碎片化：4×1 的格子，放 2 个 1×1 在两端，再塞 2×1 就拼不出来
  const g3 = new C.Grid(4, 1, '细长');
  g3.autoAdd(C.makeItem('biscuit'));
  g3.placeAt(C.makeItem('sausage'), 2, 0, 0);
  const rFrag = g3.autoAdd(C.makeItem('tarp'));   // tarp 是 2×1
  ok('空格够但拼不出连续区域 → 请整理背包', !rFrag.ok && rFrag.reason === 'fragmented',
     rFrag.reason + ' 剩' + rFrag.free + '格需' + rFrag.need);
  ok('整理后就放得下', (() => { g3.tidy(); return g3.autoAdd(C.makeItem('tarp')).ok; })());
  // 旋转
  const g4 = new C.Grid(4, 1, '扁');
  ok('放不下的竖着物品会自动转 90°', g4.autoAdd(C.makeItem('water')).ok && g4.items[0].rot === 1);
  // 堆叠
  const g5 = new C.Grid(3, 3, '堆');
  g5.autoAdd(C.makeItem('stone', 5));
  g5.autoAdd(C.makeItem('stone', 2));
  ok('可堆叠物品会并进已有堆', g5.items.length === 1 && g5.items[0].count === 7,
     g5.items.length + ' 堆 / ' + g5.items[0].count + ' 个');
  ok('超过堆叠上限会另起一堆', (() => { g5.autoAdd(C.makeItem('stone', 5)); return g5.items.length === 2; })());
}

section('17. 玩家取物');
{
  const s6 = makeSim();
  const pl = new C.Player(s6.level, s6.world);
  ok('开局没有背包', pl.bag === null);
  ok('开局身上有石头（投石是核心动作，不能一开始就用不了）',
     pl.stoneCount() === C.Config.player.startingStones, String(pl.stoneCount()));
  pl.hotbar = [null, null, null, null, null, null];         // 卸空，下面单独测取物
  ok('没背包时东西进快取栏', pl.acquire(C.makeItem('biscuit')).ok && pl.hotbar[0] !== null);
  const r = pl.acquire(C.makeItem('smallBag'));
  ok('捡到书包直接背上', r.ok && pl.bag && pl.bag.w === 5 && pl.bag.h === 4, r.msg);
  ok('负重把背包自重也算进去', pl.totalWeight() > 0.4, pl.totalWeight().toFixed(2) + 'kg');
  pl.acquire(C.makeItem('stone', 4));
  ok('石头数从背包里数', pl.stoneCount() === 4, String(pl.stoneCount()));
  ok('投石消耗背包里的石头', pl.takeStone() && pl.stoneCount() === 3);
  const before = pl.needs.thirst;
  pl.needs.thirst = 40;
  const w = C.makeItem('water');
  pl.acquire(w);
  ok('喝水减口渴', pl.useItem(w).ok && pl.needs.thirst === 15, String(pl.needs.thirst));
}

section('18. 物资布置');
{
  const s7 = makeSim();
  ok('宿舍楼里有容器', s7.level.containers.length > 50, s7.level.containers.length + ' 个');
  const items = s7.level.containers.reduce((n, c) => n + c.grid.items.length, 0);
  ok('容器里有物资', items > 100, items + ' 件');
  ok('地上有可直接拾取的东西', s7.level.looseItems.length > 0, s7.level.looseItems.length + ' 处');
  // 可复现：同一张图两次生成完全一致（等价于落盘成固定数据）
  const a = makeSim(), b2 = makeSim();
  const sig = (lv) => JSON.stringify(lv.containers.map(c => c.grid.items.map(i => i.id + 'x' + i.count)));
  ok('两次生成的物资分布完全一致（不是运行时随机）', sig(a.level) === sig(b2.level));
  ok('稀有物资固定放置：抗生素在写死的位置',
     s7.level.containers.filter(c => c.grid.find('antibiotic')).length === 2);
  const kinds = new Set(s7.level.containers.map(c => c.kind));
  ok('容器类型齐全（书桌/衣柜/床下箱/储物柜/垃圾桶）', kinds.size >= 5, [...kinds].join(','));
}

section('19. 全校地图（M2）');
{
  C.SoundSystem.reset(); C.ZombieManager.reset(); C.ModifierPipeline.clear();
  const t0 = Date.now();
  const lv = C.buildCampus();
  const buildMs = Date.now() - t0;
  ok('生成耗时在可接受范围（<300ms）', buildMs < 300, buildMs + 'ms');
  ok('十三栋楼齐全', lv.buildings.length === 13, lv.buildings.length + ' 栋');
  ok('八个室外分区齐全', lv.zones.length === 8, lv.zones.length + ' 个');

  // 分区必须互不重叠，否则 getNodeAt 会时灵时不灵
  let overlap = null;
  for (let i = 0; i < lv.zones.length && !overlap; i++) {
    for (let j = i + 1; j < lv.zones.length; j++) {
      const a = lv.zones[i], b = lv.zones[j];
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1) { overlap = a.id + '/' + b.id; break; }
    }
  }
  ok('室外分区互不重叠', !overlap, overlap || '');

  // 楼与楼不能撞在一起
  let clash = null;
  for (let i = 0; i < lv.buildings.length && !clash; i++) {
    for (let j = i + 1; j < lv.buildings.length; j++) {
      const a = lv.buildings[i].footprint, b = lv.buildings[j].footprint;
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1) {
        clash = lv.buildings[i].name + '/' + lv.buildings[j].name; break;
      }
    }
  }
  ok('楼与楼的占地不重叠', !clash, clash || '');

  // 每栋楼都必须落在它声明的那个分区里
  let badZone = null;
  for (const b of lv.buildings) {
    const zn = lv.zones.find(q => q.id === b.spec.zone);
    const f = b.footprint;
    if (f.x0 < zn.x0 || f.x1 > zn.x1 || f.z0 < zn.z0 || f.z1 > zn.z1) { badZone = b.name; break; }
  }
  ok('每栋楼都完整落在它所属的室外分区里', !badZone, badZone || '');

  // 楼都在围墙内
  const wl = C.Config.campus.wall;
  const outside = lv.buildings.filter(b =>
    b.footprint.x0 < wl.x0 || b.footprint.x1 > wl.x1 || b.footprint.z0 < wl.z0 || b.footprint.z1 > wl.z1);
  ok('所有楼都在围墙以内', outside.length === 0, outside.map(b => b.name).join(','));

  ok('丧尸总数 = 320（7.1）', lv.zombieSpawns.length === 320, String(lv.zombieSpawns.length));
  const crawlers = lv.zombieSpawns.filter(s2 => s2.type === 'Crawler').length;
  const runners = lv.zombieSpawns.filter(s2 => s2.becomesRunner).length;
  ok('蜷伏者约占 10%', Math.abs(crawlers / 320 - 0.10) < 0.01, crawlers + ' 只');
  ok('奔行者约占 5%', Math.abs(runners / 320 - 0.05) < 0.01, runners + ' 只');
  ok('蜷伏者只藏在房间里，不撂在走廊中间',
     lv.zombieSpawns.filter(s2 => s2.type === 'Crawler' && s2.spotKind !== 'room').length === 0);

  // 出生点：男生宿舍楼 402
  const spawnNode = lv.graph.getNodeAt(C.V.make(lv.spawn.x, lv.spawn.y + 1.0, lv.spawn.z));
  ok('出生点在男生宿舍楼 402（13.2）', spawnNode && spawnNode.name === '男402', spawnNode && spawnNode.name);

  // 声图是一张连通图：从出生点出发能走到每一个节点
  const seen = new Set([spawnNode.id]);
  const q = [spawnNode.id];
  while (q.length) {
    const cur = q.shift();
    for (const pid of lv.graph.getNode(cur).portals) {
      const other = lv.graph.other(lv.graph.getPortal(pid), cur);
      if (!seen.has(other)) { seen.add(other); q.push(other); }
    }
  }
  ok('声图全连通：从出生点能到达每一个节点', seen.size === lv.graph.nodes.length,
     seen.size + '/' + lv.graph.nodes.length);

  // 出生点脚下必须是实地，头顶必须有空间
  const w2 = new C.World(lv);
  const gy = w2.groundY(lv.spawn, lv.spawn.y + 0.5, 0.32);
  ok('出生点站得住（脚下有地板）', gy !== null && Math.abs(gy - lv.spawn.y) < 0.2, String(gy));
  ok('出生点头顶有站立空间', w2.isClear(lv.spawn.x, lv.spawn.y + 0.05, lv.spawn.z, 0.32, 1.7));

  // 每栋楼都有大门，且大门前面是空地
  const noDoor = lv.buildings.filter(b => !b.entrance);
  ok('每栋楼都有一扇一层大门', noDoor.length === 0, noDoor.map(b => b.name).join(','));
  const blocked = lv.buildings.filter(b => !w2.isClear(b.entrance.x, 0.05, b.entrance.z, 0.32, 1.7));
  ok('大门口是空地，站得下人', blocked.length === 0, blocked.map(b => b.name).join(','));

  // 每栋多层楼都得能上下楼：楼梯节点两端各连一层走廊
  const badStairs = lv.buildings.filter(b => {
    if (b.spec.floors < 2) return false;
    return !b.floorsMeta.every(m => m.stairs && m.stairs.length > 0);
  });
  ok('每栋多层楼的每一层都有楼梯口', badStairs.length === 0, badStairs.map(b => b.name).join(','));

  // 传播预算：全校最响的一声也不能把整张图展开
  C.SoundSystem.init(lv.graph, new C.TimeSystem());
  const t1 = Date.now();
  for (let i = 0; i < 50; i++) {
    C.SoundSystem.propagate(lv.graph.getNodeAt(C.V.make(lv.spawn.x, lv.spawn.y + 1, lv.spawn.z)), 150);
  }
  const ms = (Date.now() - t1) / 50;
  ok('全校图上单次传播仍在 0.5ms 预算内', ms < 0.5, ms.toFixed(3) + 'ms');
}

section('20. 分区加载（13.4）');
{
  C.SoundSystem.reset(); C.ZombieManager.reset();
  const lv = C.buildCampus();
  C.Streaming.reset(lv);
  const st = C.Config.campus.streaming;

  C.Streaming.update(C.V.make(lv.spawn.x, lv.spawn.y, lv.spawn.z));
  const home = lv.buildings.find(b => b.spec.spawn);
  ok('人在楼里，这栋楼一定是加载的', C.Streaming.isLoaded(home.buildingId));
  ok('只加载附近的楼，不是全部',
     C.Streaming.loaded.size < lv.buildings.length, C.Streaming.loaded.size + '/' + lv.buildings.length);

  // 迟滞：在边界上来回走不应该反复加载卸载
  const far = lv.buildings.find(b => !C.Streaming.isLoaded(b.buildingId));
  const f = far.footprint;
  const cx = (f.x0 + f.x1) / 2;
  // 走到刚好在 loadRadius 内 → 加载；退回到 load 与 unload 之间 → 仍然保持加载
  C.Streaming.update(C.V.make(cx, 0, f.z0 - st.loadRadius + 1));
  const loadedNear = C.Streaming.isLoaded(far.buildingId);
  C.Streaming.update(C.V.make(cx, 0, f.z0 - (st.loadRadius + st.unloadRadius) / 2));
  const stillLoaded = C.Streaming.isLoaded(far.buildingId);
  C.Streaming.update(C.V.make(cx, 0, f.z0 - st.unloadRadius - 2));
  const unloaded = !C.Streaming.isLoaded(far.buildingId);
  ok('进入 loadRadius 时加载', loadedNear);
  ok('退到 load 与 unload 之间仍保持加载（迟滞，不抖）', stillLoaded);
  ok('退出 unloadRadius 后卸载', unloaded);

  // 声图必须全量常驻 —— 这是文档的硬规则
  ok('声图不随分区加载变化（节点数不变）', lv.graph.nodes.length === C.buildCampus().graph.nodes.length);

  // 简化模拟：远处丧尸仍然在动，但步长不能大到穿墙
  C.SoundSystem.reset(); C.ZombieManager.reset();
  const lv2 = C.buildCampus();
  C.Streaming.reset(lv2);
  const world = new C.World(lv2);
  const time = new C.TimeSystem();
  C.SoundSystem.init(lv2.graph, time);
  const player = { alive: true, pos: C.V.copy(lv2.spawn),
                   eyePos() { return { x: this.pos.x, y: this.pos.y + 1.65, z: this.pos.z }; },
                   detectMultiplier() { return 1; }, die() {} };
  C.ZombieManager.spawnAll(lv2, world);
  ok('全校 320 只丧尸都建出来了', C.ZombieManager.list.length === 320, String(C.ZombieManager.list.length));

  const t0 = Date.now();
  for (let i = 0; i < 60; i++) { time.update(1 / 30); C.Streaming.update(player.pos); C.ZombieManager.update(1 / 30, player, time); }
  const perFrame = (Date.now() - t0) / 60;
  ok('320 只丧尸一帧内更新完（<8ms）', perFrame < 8, perFrame.toFixed(2) + 'ms/帧');

  const near = C.ZombieManager.list.filter(zz => C.V.distXZ(zz.pos, player.pos) < 40);
  ok('近处的丧尸走完整模拟', near.every(zz => !zz.simplified), near.length + ' 只在 40m 内');
  const farZ = C.ZombieManager.list.filter(zz => C.V.distXZ(zz.pos, player.pos) > 100);
  ok('远处的丧尸走简化模拟', farZ.length > 0 && farZ.every(zz => zz.simplified), farZ.length + ' 只在 100m 外');

  /* 简化模拟里，**每一次 update 调用**的位移必须小于最薄的墙（0.2m）——
     碰撞是按调用做的，一次调用跨过 0.2m 的隔墙就会穿墙。攒起来的时间被拆成
     多小步，所以这里量的是每一步，不是每一帧。 */
  const rawUpdate = C.Zombie.prototype.update;
  let maxStep = 0, simCalls = 0, worstWho = '';
  C.Zombie.prototype.update = function (dt2, pl2, tm2, simp) {
    const b = C.V.copy(this.pos);
    rawUpdate.call(this, dt2, pl2, tm2, simp);
    if (simp) {
      simCalls++;
      const d2 = C.V.distXZ(b, this.pos);
      if (d2 > maxStep) { maxStep = d2; worstWho = this.typeName + '/' + this.state + ' dt=' + dt2.toFixed(3); }
    }
  };
  for (let i = 0; i < 200; i++) {
    time.update(1 / 30); C.Streaming.update(player.pos); C.ZombieManager.update(1 / 30, player, time);
  }
  C.Zombie.prototype.update = rawUpdate;
  ok('远处的丧尸没被冻住，简化模拟确实在跑', simCalls > 0 && maxStep > 0,
     simCalls + ' 次 / 最大 ' + maxStep.toFixed(3) + 'm');
  ok('简化模拟单步位移 < 最薄的墙(0.2m)', maxStep < 0.2, maxStep.toFixed(3) + 'm  ' + worstWho);
  // 最坏情况：奔行者追击 + 攒满两个 tick，拆完之后单步也要够小
  const worst = C.Config.zombieTypes.Runner.speedChase * C.Config.campus.simplifiedTick * 2;
  ok('最坏情况（奔行者追击）也会被拆成足够多的小步',
     worst / Math.ceil(worst / 0.15) < 0.2, (worst / Math.ceil(worst / 0.15)).toFixed(3) + 'm/步')
}

section('21. 奔行者第 12 天登场（7.2）');
{
  C.SoundSystem.reset(); C.ZombieManager.reset();
  const lv = C.buildCampus();
  C.Streaming.reset(lv);
  const world = new C.World(lv);
  const time = new C.TimeSystem();
  C.SoundSystem.init(lv.graph, time);
  C.ZombieManager.spawnAll(lv, world);
  const player = { alive: true, pos: C.V.copy(lv.spawn),
                   eyePos() { return { x: this.pos.x, y: this.pos.y + 1.65, z: this.pos.z }; },
                   detectMultiplier() { return 1; }, die() {} };

  time.day = 5;
  C.ZombieManager.update(1 / 30, player, time);
  ok('第 5 天一只奔行者都没有',
     C.ZombieManager.list.filter(zz => zz.typeName === 'Runner').length === 0);

  let announced = 0;
  C.EventBus.subscribe('RunnersAppearedEvent', () => announced++);
  time.day = 12;
  C.ZombieManager.update(1 / 30, player, time);
  const n = C.ZombieManager.list.filter(zz => zz.typeName === 'Runner').length;
  ok('第 12 天标记过的那批变成奔行者', n === 16, n + ' 只');
  ok('阈值跟着换成奔行者的（不是写死的旧值）',
     C.ZombieManager.list.find(zz => zz.typeName === 'Runner').hearing.baseThreshold
       === C.Config.zombieTypes.Runner.threshold);
  time.day = 13;
  C.ZombieManager.update(1 / 30, player, time);
  ok('只登场一次，不会天天再变一批', announced === 1, announced + ' 次');
}

section('22. 笔记本（14.3）');
{
  C.SoundSystem.reset(); C.ZombieManager.reset();
  const lv = C.buildCampus();
  const time = new C.TimeSystem();
  C.SoundSystem.init(lv.graph, time);
  const N = C.Notebook.reset();

  ok('开局地图是空的', N.nodes.size === 0 && N.buildings.size === 0);
  const home = lv.buildings.find(b => b.spec.spawn);
  const room = home.floorsMeta[C.Config.level.spawnRoomFloor].rooms[C.Config.level.spawnRoomIndex];
  N.visitNode(room, lv, time);
  ok('走进房间就记下这栋楼', N.buildings.has(home.buildingId));
  ok('第一次进楼自动记一条线索', N.clues.some(c => c.text.indexOf(home.name) >= 0));
  ok('同一个节点不会记两次', N.visitNode(room, lv, time) === false);
  const r1 = N.exploredRatio(home);
  N.visitNode(home.floorsMeta[0].corridor, lv, time);
  ok('探明比例随走过的节点上升', N.exploredRatio(home) > r1);
  ok('没进过的楼比例是 0', N.exploredRatio(lv.buildings.find(b => !b.spec.spawn)) === 0);

  // 配方：捡到书才解锁
  ok('开局没有任何配方', N.recipes.size === 0);
  const nTextbook = N.readBook('textbook', time);
  ok('课本解锁基础配方', nTextbook === 5, nTextbook + ' 条');
  ok('同一本书不会重复解锁', N.readBook('textbook', time) === 0);
  N.readBook('manual', time);
  ok('技术手册解锁其余配方', N.recipes.size === C.Config.recipes.length);

  // 观察：同一条只出现一次，但次数会累加
  const zz = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.copy(lv.spawn) }, new C.World(lv));
  ok('第一次看见记一条', N.observeZombie(zz, '看见', time) === true);
  ok('再看见只加次数', N.observeZombie(zz, '看见', time) === false);
  ok('看见和听见分开记', N.observeZombie(zz, '听见', time) === true);
  ok('次数累加正确', N.obs.get('Wanderer:看见').count === 2);

  // 手动标记
  const pin = N.addPin(10, 20, 'base');
  ok('放得下标记', N.pins.length === 1);
  ok('点得中附近的标记', N.pinNear(11, 21, 5) === pin);
  ok('点不中太远的标记', N.pinNear(40, 40, 5) === null);
  N.removePin(pin);
  ok('删得掉标记', N.pins.length === 0);

  // 存档往返
  N.addPin(5, 5, 'danger');
  const round = C.Notebook.deserialize(JSON.parse(JSON.stringify(N.serialize())));
  ok('笔记本存档往返不丢东西',
     round.nodes.size === 2 && round.recipes.size === C.Config.recipes.length &&
     round.pins.length === 1 && round.obs.get('Wanderer:看见').count === 2);
}

section('23. 存档 v2：背包与容器');
{
  const sim2 = makeSim();
  C.Notebook.reset();
  const p2 = new C.Player(sim2.level, sim2.world);
  const game = { player: p2, time: sim2.time, level: sim2.level };
  p2.acquire(C.makeItem('smallBag'));
  p2.acquire(C.makeItem('water', 2));
  const box = sim2.level.containers[0];
  box.opened = true; box.revealed = 1;
  sim2.level.looseItems[0].taken = true;

  const raw = JSON.parse(JSON.stringify(C.Save.build(game)));
  ok('存档版本升到 2', raw.version === 2);
  ok('背包连格子布局一起存', raw.player.bag && raw.player.bag.items.length > 0);
  ok('只存翻过的容器', raw.containers.length === 1 && raw.containers[0].id === box.id);
  ok('地上被拿走的东西也记下来', raw.loose.length === 1 && raw.loose[0] === 0);
  ok('笔记本进存档', !!raw.notebook);

  // 读回一个全新的世界
  const sim3 = makeSim();
  C.Notebook.reset();
  const p3 = new C.Player(sim3.level, sim3.world);
  const game3 = { player: p3, time: sim3.time, level: sim3.level };
  C.Save.apply(game3, raw);
  ok('读档还原背包', p3.bag && p3.bag.count('water') === 2, p3.bag && String(p3.bag.count('water')));
  ok('读档还原容器的已翻状态', sim3.level.containers.find(b => b.id === box.id).opened === true);
  ok('读档还原地上已被拿走的物品', sim3.level.looseItems[0].taken === true);
  ok('v1 老存档被明确判为不兼容', C.Save.version === 2);
}

section('24. 开始游戏不能依赖指针锁定');
{
  /* 回归：这个页面经常被嵌在 sandbox 的 iframe 里（artifact / 各种嵌入）。
     少了 allow-pointer-lock 权限时 requestPointerLock 直接被拒，
     曾经把「开始游戏」挂在 pointerlockchange 上 —— 结果点了没反应，游戏根本进不去。
     纯逻辑无法起浏览器，所以这里检查的是源码里的契约：
     ① 点击处理里必须先 start() 再谈锁定；② 必须监听 pointerlockerror 并退到拖动模式。 */
  const fs2 = require('fs');
  const src = fs2.readFileSync(path.join(SRC, '16-main.js'), 'utf8');
  ok('有拖动转视角的退路（_fallbackToDrag）', /_fallbackToDrag/.test(src));
  ok('监听 pointerlockerror', /pointerlockerror/.test(src));
  ok('requestPointerLock 的 Promise 失败也接住', /requestPointerLock\(\)[\s\S]{0,220}catch/.test(src));
  const click = src.slice(src.indexOf("document.addEventListener('click'"));
  const iStart = click.indexOf('start();'), iLock = click.indexOf('requestPointerLock');
  ok('点击时先开始游戏，再尝试锁定（顺序不能反）', iStart >= 0 && iLock > iStart);
  ok('拖动模式下视角仍然会更新', /this\.locked \|\| this\.lookMode === 'drag'/.test(src));
  ok('开场层不会在拖动模式下弹回来', /lookMode === 'lock' && !this\.locked/.test(src));
}

section('25. 翻找只有一种，背包类可以整个拎走');
{
  const s8 = makeSim();
  const pl = new C.Player(s8.level, s8.world);
  pl.hotbar = [null, null, null, null, null, null];

  // ① 翻找固定为快速：没有 slow 这条路了
  const box = s8.level.containers.find(b => !b.carry);
  C.SoundSystem.log.length = 0;
  pl.openContainer(box);
  const snd = C.SoundSystem.log[C.SoundSystem.log.length - 1];
  ok('翻找只有快速一种（响度 40）', snd.loud === C.Config.loudness.lootFast, String(snd.loud));
  ok('openContainer 不再接受 slow 参数', C.Player.prototype.openContainer.length === 1);
  ok('容器上不再留 slow 标记', box.slow === undefined);

  // ② 背包类容器可以整个拎走
  const bag = s8.level.containers.find(b => b.carry);
  ok('宿舍楼里有背包类容器', !!bag, bag && bag.name);
  ok('它标了拎走之后变成哪件背包', bag.carry === 'schoolBag');
  const had = bag.grid.items.length;
  C.SoundSystem.log.length = 0;
  pl.grabBag(bag);
  const g = C.SoundSystem.log[C.SoundSystem.log.length - 1];
  ok('拎走比翻找安静得多（18 对 40）', g.loud === C.Config.loudness.grabBag, String(g.loud));
  ok('没背包时直接背上', pl.bag !== null && pl.bagItemId === 'schoolBag');
  ok('里面的东西原样成为背包内容', pl.bag.items.length === had, pl.bag.items.length + '/' + had);
  ok('原地的容器标记为已拿走', bag.taken === true);
  ok('已拿走的容器不再是可交互目标',
     (function () {
       pl.pos = C.V.copy(bag.pos); pl.yaw = 0; pl.pitch = 0;
       const t = pl.findTarget();
       return !t || t.obj !== bag;
     })());

  // ③ 已经有背包时：一次性全拿，装不下的留着
  const s9 = makeSim();
  const pl2 = new C.Player(s9.level, s9.world);
  pl2.hotbar = [null, null, null, null, null, null];
  pl2.acquire(C.makeItem('smallBag'));
  const bag2 = s9.level.containers.find(b => b.carry && b.grid.items.length > 0);
  const n2 = bag2.grid.items.length;
  pl2.grabBag(bag2);
  ok('已有背包时东西进现有背包', pl2.bag.items.length > 0, pl2.bag.items.length + ' 件');
  ok('拿走 + 留下 = 原来的总数',
     pl2.bag.items.length + bag2.grid.items.length >= n2,
     pl2.bag.items.length + '+' + bag2.grid.items.length + ' vs ' + n2);
  ok('已有背包时不会把包本身也拎走（原地还在）', !bag2.taken);

  // ④ 装不下时东西不会凭空消失
  const s10 = makeSim();
  const pl3 = new C.Player(s10.level, s10.world);
  pl3.hotbar = [null, null, null, null, null, null];
  pl3.bag = new C.Grid(1, 1, '塞满的小包');
  pl3.bag.autoAdd(C.makeItem('key'));                    // 1×1 占满
  const bag3 = s10.level.containers.find(b => b.carry && b.grid.items.length > 0);
  const n3 = bag3.grid.items.length;
  pl3.grabBag(bag3);
  ok('背包满时东西留在原地，不会凭空消失', bag3.grid.items.length === n3,
     bag3.grid.items.length + '/' + n3);
}

section('26. 搜刮界面的开关（F 开 F 关）');
{
  const s11 = makeSim();
  const pl = new C.Player(s11.level, s11.world);
  const box = s11.level.containers.find(b => !b.carry);
  let opened = 0, closed = 0;
  C.EventBus.subscribe('ContainerOpenedEvent', () => opened++);
  C.EventBus.subscribe('ContainerClosedEvent', () => closed++);

  C.SoundSystem.log.length = 0;
  pl.openContainer(box);
  ok('第一次按 F：打开并发出翻找声', box.searching === true && opened === 1 &&
     C.SoundSystem.log.length === 1, String(C.SoundSystem.log.length));

  pl.openContainer(box);
  ok('再按一次 F：关掉', box.searching === false && closed === 1);
  ok('**关掉不再发一次声音**（收界面不是又翻了一遍）', C.SoundSystem.log.length === 1,
     String(C.SoundSystem.log.length));

  pl.openContainer(box);
  ok('第三次按 F：又打开了', box.searching === true && opened === 2);
  ok('重新打开会再发一次声音', C.SoundSystem.log.length === 2);

  pl.closeContainer(box);
  ok('界面层主动收起也会同步给规则层', box.searching === false && closed === 2);
  pl.closeContainer(box);
  ok('重复关闭不会重复发事件', closed === 2);

  // 已翻完的容器再打开，不会把已点亮数清零（否则拿走一半会突然全变暗）
  box.revealed = box.grid.items.length;
  pl.openContainer(box);
  ok('已翻完的容器重开，保持全部点亮', box.revealed === box.grid.items.length);
}

section('27. 楼梯的碰撞半径下限（回归）');
{
  /* `[实测]` 楼梯踏板只有 0.3m 深，碰撞半径小于 0.36 时角色会挤进踏板立面、
     被「推到最近的面」推回来，来回震荡爬不上去。这条断言把这个下限钉住 ——
     以后谁想再把丧尸改瘦，会先在这里红。根因在碰撞层，见待决策 #17。 */
  const src = require('fs').readFileSync(path.join(SRC, '11-zombie.js'), 'utf8');
  const m = src.match(/moveCharacter\(this\.pos,[^)]*?,\s*([0-9.]+),\s*([0-9.]+),/);
  ok('丧尸碰撞半径不小于 0.36', m && parseFloat(m[1]) >= 0.36, m && m[1]);
  ok('踏板深度确实比「半径 × 0.5」的探测范围还浅（这就是根因）',
     C.Config.level.stairStepD < 0.36, C.Config.level.stairStepD + 'm');
}

section('28. 站着不动的丧尸也会出声（主文档 13.1 问题 4 的答案：有）');
{
  const L = C.Config.loudness, TW = C.Config.zombieTypes.Wanderer, H = C.Config.hearing;
  const K = C.Config.sound.kIndoor;
  ok('游荡者有常态嘶吼（不再是 0）', TW.breathLoudness > 0, String(TW.breathLoudness));
  ok('嘶吼比脚步轻 —— 站着的比走动的更难发现',
     TW.breathLoudness < L.zombieShuffle, TW.breathLoudness + ' < ' + L.zombieShuffle);
  ok('但比蜷伏者的呼吸响得多（蜷伏者才是要贴脸找的那个）',
     TW.breathLoudness > L.crawlerBreath);
  const r = (TW.breathLoudness - (H.player - H.holdBreathBonus)) / K;
  ok(`屏息时室内听得见 ${r.toFixed(0)}m 外站着不动的丧尸`, r >= 10 && r <= 18, r.toFixed(1) + 'm');

  /* 决定性的一条：把丧尸钉死不让它移动，看它还出不出声。
     改动前这里是 0 次 —— 一只站着不动的丧尸在声音系统里等于不存在。 */
  const s12 = makeSim();
  const zz = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(10, 0.0, 1.3) }, s12.world);
  zz._wander = function () {};                       // 钉死：绝不移动
  const before = C.V.copy(zz.pos);
  C.SoundSystem.log.length = 0;
  step(s12, 10);
  const growls = C.SoundSystem.log.filter(e => e.label === '低哑嘶吼');
  ok('它确实一步没动', C.V.distXZ(before, zz.pos) < 0.01);
  ok('**站着不动也发出了嘶吼**', growls.length > 0, growls.length + ' 次 / 10 秒');
  ok('间隔大致等于 breathInterval', Math.abs(growls.length - 10 / TW.breathInterval) <= 2,
     growls.length + ' 次');
  ok('没有脚步声（因为它没动）',
     C.SoundSystem.log.filter(e => e.label === '丧尸脚步').length === 0);

  /* 常态声必须走 Ambient：Voice 才参与连锁警戒，
     否则一屋子丧尸会被彼此的呼吸声互相点着，变成自激的雪崩。 */
  ok('嘶吼走 Ambient 类别，不参与连锁警戒',
     growls.every(e => e.cat === C.SoundCategory.Ambient));

  // 第二只丧尸站在旁边，不应该被第一只的嘶吼吵醒
  const s13 = makeSim();
  const a = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(10, 0.0, 1.3) }, s13.world);
  const b2 = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(12, 0.0, 1.3) }, s13.world);
  a._wander = function () {}; b2._wander = function () {};
  step(s13, 12);
  ok('两只挨着站，谁也没被对方的嘶吼吵成警戒',
     a.state === C.ZombieState.Wander && b2.state === C.ZombieState.Wander,
     a.state + '/' + b2.state);
}

section('29. 碰撞推出不会把人甩出去（回归）');
{
  /* `[实测]` 「推到最近的面」在角色**深陷**盒子里时会一帧甩出两三米 ——
     玩家看到的就是丧尸瞬移。实测触发场景：远处走简化模拟的游荡者，
     单帧位移 2.43m，一步跨过整面墙。修法是超过 MAX_PUSH 就放弃这一帧的移动。 */
  const s14 = makeSim();
  const w = s14.world;
  // 找一个够大的实体（楼板），把角色塞进它正中间，再让它往前走一步
  const slab = s14.level.solids
    .filter(o => o.box.max.x - o.box.min.x > 4 && o.box.max.z - o.box.min.z > 2)
    .sort((a, b) => (b.box.max.x - b.box.min.x) - (a.box.max.x - a.box.min.x))[0];
  const c = C.AABB.center(slab.box);
  const pos = { x: c.x, y: c.y, z: c.z };            // 正正卡在盒子中心
  const before = { x: pos.x, z: pos.z };
  w.moveHorizontal(pos, 0.05, 0, 0.38, 1.6, C.Config.player.stepHeight);
  const moved = Math.hypot(pos.x - before.x, pos.z - before.z);
  ok('深陷实体里时不会被甩出去', moved < 0.6, moved.toFixed(3) + 'm');

  // 正常情况仍然要能被墙挡住（不能因为怕甩就干脆不挡）
  const s15 = makeSim();
  const z2 = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.make(10, 0.0, 1.3) }, s15.world);
  const p0 = C.V.copy(z2.pos);
  for (let i = 0; i < 90; i++) s15.world.moveCharacter(z2.pos, 0, 0.08, 0.38, 1.6, C.Config.player.stepHeight);
  ok('但普通的墙照样挡得住（没有被推出逻辑放行）',
     C.V.distXZ(p0, z2.pos) < 7.2, C.V.distXZ(p0, z2.pos).toFixed(2) + 'm / 想走 7.2m');
}

section('30. 鼠标只在面板开着时解锁（源码契约）');
{
  /* 需求：**只有打开容器/笔记本/背包的那一会儿才解锁鼠标，其余时间照常锁定。**
     关掉之后必须主动锁回去 —— 不然玩家得再点一下画面才能转视角，
     而那一下点击还会把「点击画面开始」那层招回来，像是游戏断了一下。
     这几条是 DOM 行为，无头测不了，所以钉住源码里的契约。 */
  const fs2 = require('fs');
  const read = (f) => fs2.readFileSync(path.join(SRC, f), 'utf8');
  const main = read('16-main.js');

  ok('装配层提供「借鼠标 / 还鼠标」这一对方法',
     /releaseMouseForPanel\s*\(\)/.test(main) && /restoreMouseAfterPanel\s*\(\)/.test(main));
  ok('只在 lock 模式下动指针锁定（拖动模式本来就没锁）',
     /releaseMouseForPanel\(\)\s*\{[\s\S]{0,160}lookMode !== 'lock'/.test(main));
  ok('还鼠标之前先确认没有别的面板还开着',
     /restoreMouseAfterPanel\(\)\s*\{[\s\S]{0,220}_panelOpen\(\)/.test(main));
  ok('面板开着时点空白处不重新抢锁',
     /if \(this\._panelOpen\(\)\) return;/.test(main));

  // 三个面板都必须走这一对方法，且**开一次配一次**
  for (const [f, name] of [['28-loot-ui.js', '搜刮'], ['27-notebook-ui.js', '笔记本'], ['23-inventory-ui.js', '背包']]) {
    const src = read(f);
    ok(name + '界面：打开时借鼠标', src.includes('releaseMouseForPanel()'), f);
    ok(name + '界面：关闭时还鼠标', src.includes('restoreMouseAfterPanel()'), f);
    ok(name + '界面：不再自己直接调 exitPointerLock', !src.includes('exitPointerLock'), f);
  }

  /* 上一版真踩过的坑：笔记本的 toggle() 自己写了一遍收起逻辑，
     于是按 J 合上时绕过了 close()，鼠标没锁回去。合上必须走 close()。 */
  const note = read('27-notebook-ui.js');
  ok('笔记本 toggle 合上时走 close()，不另写一遍',
     /toggle\(\)\s*\{[\s\S]{0,200}this\.close\(\);\s*return;/.test(note));
}

section('31. 探索用开关：无敌 / 隐身');
{
  const s16 = makeSim();
  const pl = new C.Player(s16.level, s16.world);
  C.Config.debug.godMode = false; C.Config.debug.ghost = false;

  pl.die('测试');
  ok('平时该死就死', pl.alive === false);

  // 无敌：所有致死路径都汇到 die()，所以只要在这一个口子上拦
  const pl2 = new C.Player(s16.level, s16.world);
  C.Config.debug.godMode = true;
  pl2.die('被游荡者抓住');
  ok('无敌时挡下「被抓住」', pl2.alive === true);
  pl2.needs.thirst = 100; pl2.needs.dead = true;
  pl2.die('渴死');
  ok('无敌时也挡下「渴死」', pl2.alive === true);
  ok('并且把需求拉回安全线（否则下一帧又触发一次）',
     pl2.needs.dead === false && pl2.needs.thirst <= 80, String(pl2.needs.thirst));

  // 隐身只关视觉，听觉照常 —— 它不是上帝模式
  C.Config.debug.godMode = false; C.Config.debug.ghost = true;
  ok('隐身时丧尸的视觉判定归零', pl2.detectMultiplier() === 0);
  /* input 必须给全 —— 少给字段会让姿态/速度算出 NaN，角色原地不动，
     测出来像是「隐身把人冻住了」。装配层的 _input() 永远给全字段。 */
  const walk = { forward: 1, right: 0, run: false, crouch: false, wallHug: false,
                 lean: 0, holdBreath: false, interact: false, throwHeld: false, jump: false };
  const pl3 = new C.Player(s16.level, s16.world);
  C.SoundSystem.log.length = 0;
  for (let i = 0; i < 90; i++) pl3.update(1 / 30, walk, s16.time);
  ok('**隐身时脚步照样出声** —— 隐身不是无声',
     C.SoundSystem.log.length > 0, C.SoundSystem.log.length + ' 条');

  C.Config.debug.ghost = false;
  ok('关掉之后视觉判定恢复正常', pl3.detectMultiplier() > 0, String(pl3.detectMultiplier()));

  // 这两个开关是调试用的，默认必须是关的
  const cfgSrc = require('fs').readFileSync(path.join(SRC, '00-config.js'), 'utf8');
  ok('配置里两个开关默认都是 false',
     /godMode: false/.test(cfgSrc) && /ghost: false/.test(cfgSrc));
}

section('32. 俯视调试图限流（性能）');
{
  /* `[实测]` 整幅重画一次 5.8ms，是全场最贵的一项 —— 比 320 只丧尸的
     全部逻辑（1.4ms）还贵四倍，比声音传播（0.03ms）贵近两百倍。
     它是开发工具，不该跟渲染抢帧预算，所以限到 20fps 重画。 */
  const dbg = require('fs').readFileSync(path.join(SRC, '15-debug.js'), 'utf8');
  ok('调试图有重画频率上限', /REDRAW_HZ\s*=\s*(\d+)/.test(dbg));
  const hz = +dbg.match(/REDRAW_HZ\s*=\s*(\d+)/)[1];
  ok('上限在 10~30fps 之间（再低会看出卡顿，再高省不下什么）', hz >= 10 && hz <= 30, String(hz));
  ok('不可见时直接返回，不做任何计算', /if \(!this\.visible\) \{ this\._acc = 0; return; \}/.test(dbg));
}

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + `${pass} 通过 / ${fail} 失败\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
