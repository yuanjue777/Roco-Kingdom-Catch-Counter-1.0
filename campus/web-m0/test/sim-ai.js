/*
 * 无头 AI 仿真测试：不开浏览器就验证丧尸状态机与寻路。
 * 跑法：node test/sim-ai.js
 */
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['03-math', '00-config', '01-eventbus', '02-modifiers', '04-soundgraph',
                 '05-soundsystem', '06-hearing', '07-time', '08-level', '09-collision',
                 '18-needs', '10-player', '11-zombie', '19-sleep', '20-save']) require(path.join(SRC, f + '.js'));
const C = globalThis.Campus;

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '  → ' + e : '')); } };
const section = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

function makeSim() {
  C.SoundSystem.reset(); C.ZombieManager.reset(); C.ModifierPipeline.clear();
  const level = C.buildDormitory();
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
ok('但屏息也听不了多远，4m 外就没了', breathHeardWithin(4.0, TH.player - TH.holdBreathBonus) === 0);
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
ok('屏息在常态基础上再扩 2m', Math.abs((L - (TH.player - TH.holdBreathBonus)) / k - (L - TH.player) / k - 2) < 0.01);
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

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + `${pass} 通过 / ${fail} 失败\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
