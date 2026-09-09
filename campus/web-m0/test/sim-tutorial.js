/*
 * 新手教学的无头测试。跑法：node test/sim-tutorial.js
 * 这一套盯的是**设计判断**，不是像素：危险分层、205 永远出不来、提示只出现一次。
 */
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['03-math', '00-config', '01-eventbus', '02-modifiers', '04-soundgraph',
                 '05-soundsystem', '06-hearing', '07-time', '08-level', '09-collision',
                 '18-needs', '21-items', '22-loot', '10-player', '11-zombie',
                 '24-campus', '25-streaming', '26-notebook',
                 '29-power', '30-cooking', '31-tutorial']) require(path.join(SRC, f + '.js'));
const C = globalThis.Campus;

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '  → ' + e : '')); } };
const section = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

function campus() {
  C.SoundSystem.reset(); C.ZombieManager.reset(); C.ModifierPipeline.clear(); C.EventBus.clear();
  const level = C.buildCampus();
  C.placeCampusContainers(level); C.placeCampusLooseItems(level);
  const world = new C.World(level);
  const time = new C.TimeSystem();
  C.SoundSystem.init(level.graph, time, (a, b) => world.lineOfSight(a, b));
  C.Streaming.reset(level); C.Power.reset(level); C.Cooking.reset();
  C.Tutorial.reset(true);
  return { level, world, time };
}

section('1. 危险分层：宿舍楼不能一只丧尸都没有');
{
  const s = campus();
  const home = s.level.buildings.find(b => b.spec.spawn);
  const H = C.Config.level.floorHeight;
  const mine = s.level.zombieSpawns.filter(z => z.buildingId === home.spec.id);
  const onFloor = (f) => mine.filter(z => Math.round(z.pos.y / H) === f).length;

  ok('**不是空楼** —— 空楼会教会玩家一个没有威胁的游戏', mine.length > 0, mine.length + ' 只');
  ok('出生的四楼 0 只（绝对安全：移动/搜刮/背包/需求）', onFloor(3) === 0);
  ok('三楼 0 只（绝对安全：电力/水/手电）', onFloor(2) === 0);
  ok('二楼 1 只（安全但有临场感）', onFloor(1) === 1);
  ok('一楼 1 只（第一次真正的考试）', onFloor(0) === 1);
  ok('全楼一共 2 只', mine.length === 2);

  const locked = mine.find(z => z.lockedIn);
  ok('二楼那只是**锁死的**', locked && Math.round(locked.pos.y / H) === 1);
  ok('一楼那只不锁，是真威胁', mine.find(z => !z.lockedIn && Math.round(z.pos.y / H) === 0));

  /* 玩家在见到第一只可能伤害自己的丧尸之前，有约 15 分钟的完全安全时间。
     「安心入手」完全满足，而且**教学没有骗人**。 */
  ok('从出生层往下两层都没有威胁', onFloor(3) + onFloor(2) === 0);

  // **计入全校 320 总数**（教学设计 第五部分一致性检查）
  ok('全校总数仍然是 320', s.level.zombieSpawns.length === 320, String(s.level.zombieSpawns.length));
}

section('2. 205 的那只：永远出不来');
{
  const s = campus();
  C.ZombieManager.spawnAll(s.level, s.world);
  const z = C.ZombieManager.list.find(x => x.lockedIn);
  ok('它存在', !!z);
  const player = { alive: true, pos: C.V.copy(z.pos),
                   eyePos() { return { x: this.pos.x, y: this.pos.y + 1.65, z: this.pos.z }; },
                   detectMultiplier() { return 1; }, die() {} };
  C.Streaming.update(player.pos);
  C.ZombieManager.update(1 / 30, player, s.time);   // homeNodeId 是第一帧才落定的
  const home = z.homeNodeId;
  const p0 = C.V.copy(z.pos);

  // 往它旁边扔一个很响的声音，让它进入追击
  C.SoundSystem.emit({ worldPosition: C.V.copy(z.pos), loudness: 120,
                       category: C.SoundCategory.Impact, emitterId: -1 });
  for (let i = 0; i < 30 * 40; i++) C.ZombieManager.update(1 / 30, player, s.time);

  ok('**它没有离开自己的房间**', z.homeNodeId === home &&
     s.level.graph.getNodeAt(z.eyePos()).id === home);
  ok('它也没跑远（还在屋里来回撞）', C.V.dist(p0, z.pos) < 6, C.V.dist(p0, z.pos).toFixed(1) + 'm');

  /* 它撞门 —— 玩家听得见，这就是它的教学价值。
     订阅事件而不是翻 SoundSystem.log：那个 log 是有上限的环形缓冲，
     全校 320 只丧尸的脚步几秒就能把它冲干净。 */
  let bangs = 0, bangLoud = 0;
  C.EventBus.subscribe(C.Events.SoundEmitted, (e) => {
    if (e.label === '撞门') { bangs++; bangLoud = e.loudness; }
  });
  C.SoundSystem.emit({ worldPosition: C.V.copy(z.pos), loudness: 120,
                       category: C.SoundCategory.Impact, emitterId: -1 });
  for (let i = 0; i < 30 * 10; i++) C.ZombieManager.update(1 / 30, player, s.time);
  ok('被惊动时会扑门，撞得很响（70）', bangs > 0 && bangLoud === 70, bangs + ' 次 / ' + bangLoud);
}

section('3. 402 所在回路的闸是断的');
{
  const s = campus();
  const home = s.level.buildings.find(b => b.spec.spawn);
  /* **分闸是按楼层的**：一栋楼一个配电箱，里面每层一个闸。
     只有出生的那一层是断的 —— 走下一层楼，插座就是好的，
     玩家立刻知道「不是水壶坏了，是我这层没电」。
     `[实测]` 原来是整栋楼一条回路，于是宿舍楼 32 个插座全是死的，
     玩家学到的不是「要去推闸」，是「这游戏的插座没做完」。 */
  const c = C.Power.circuits.get('circuit-' + home.spec.id + '-' + C.Config.level.spawnRoomFloor);
  ok('出生那一层的回路存在', !!c);
  ok('**闸是断开的** —— 玩家插上水壶会发现没反应', c.breakerOn === false);
  ok('配电箱在一层', c.panelAt && c.panelAt.y < C.Config.level.floorHeight, c.panelAt && c.panelAt.y.toFixed(1));
  ok('全校只有这一条闸是断的',
     [...C.Power.circuits.values()].filter(x => !x.breakerOn).length === 1);
  ok('同一栋楼别的层是通的',
     C.Power.circuits.get('circuit-' + home.spec.id + '-2').breakerOn === true);
  // 配电箱要有实体，玩家才走得到跟前按 F
  const panel = s.level.panels.find(x => x.buildingKey === home.spec.id);
  ok('出生楼有一个能交互的配电箱', !!panel && C.V.dist(panel.pos, c.panelAt) < 0.01);

  /* **开局第一个真正的目标是：从四楼下到一楼，推上闸，再回来。全程有丧尸。**
     这就把「探索这栋楼」变成了一个具体的、有回报的目标。 */
  const spawnY = s.level.spawn.y;
  ok('从出生点到配电箱要下三层', Math.round(spawnY / C.Config.level.floorHeight) === 3);
}

section('4. 保底物品：402 的电水壶');
{
  const s = campus();
  const kettle = s.level.containers.filter(c => c.grid.find('kettle'));
  ok('**全游戏唯一一件保底物品**：402 柜子里必有电水壶',
     kettle.length >= 1 && kettle.some(c => c.roomName === '男402'),
     kettle.map(c => c.roomName).join(','));
  /* 它保证玩家从第一分钟起就能烧水净化，不会因为运气问题陷入死局。 */
  const boil = C.Config.recipes.find(r => r.id === 'boilWater');
  ok('有它就能烧水（Lv0 食谱）', boil.lv === 0);
  ok('电水壶自动断电，不会糊', C.Config.cooking.heaters.kettle.autoShutoff === true);
  ok('烧一壶只要 9 分钟 × 0.5 = 4.5 分钟', Math.abs(boil.time * C.Config.cooking.heaters.kettle.speed - 4.5) < 0.01);

  const bag = s.level.containers.find(c => c.roomName === '男403' && c.grid.find('schoolBag'));
  ok('403 有书包（目标②的答案）', !!bag);
  const stones = s.level.containers.find(c => c.roomName === '男201' && c.grid.find('stone'));
  ok('201 有石头（投石的弹药）', !!stones);
  const note = s.level.containers.find(c => c.roomName === '男206' && c.grid.find('note206'));
  ok('206 有那张字条', !!note);
}

section('5. 七个目标，全部是内心独白');
{
  const O = C.TutorialObjectives;
  ok('正好七个', O.length === 7, String(O.length));
  ok('顺序是 喝水→背包→烧水→声音→睡觉→推闸→出楼',
     O.map(o => o.id).join(',') === 'drink,bag,boil,sound,sleep,breaker,leave');
  /* **不用系统指令语气。**
       ✗「前往一楼配电间推上电闸」
       ✓「配电间在一楼。」 */
  ok('没有一条是命令句（不含「前往」「请」「去完成」）',
     O.every(o => !/前往|请|去完成|任务/.test(o.text)));
  ok('每条都以句号结尾（是自言自语，不是指令）',
     O.every(o => /[。？]$/.test(o.text)), O.map(o => o.text).join(' | '));
}

section('6. 提示：出现一次，之后永不再现');
{
  C.Tutorial.reset(true);
  ok('第一次给 T01', C.Tutorial.hint('T01', 0));
  ok('**第二次不给了**', !C.Tutorial.hint('T01', 5));
  ok('第一百次也不给', !C.Tutorial.hint('T01', 999));

  /* T09（屏息）是**全表唯一允许重复一次**的提示。
     如果玩家错过它，整个二楼的教学都会失效。 */
  C.Tutorial.reset(true);
  ok('T09 第一次给', C.Tutorial.hint('T09', 0));
  ok('8 秒内不重复', !C.Tutorial.hint('T09', 5));
  ok('8 秒后**允许再给一次**', C.Tutorial.hint('T09', 9));
  ok('但也只有这一次', !C.Tutorial.hint('T09', 30));

  C.Tutorial.reset(true);
  C.Tutorial.hint('T09', 0);
  C.Tutorial.satisfied('T09');
  ok('玩家照做了就不再提醒', !C.Tutorial.hint('T09', 20));

  const kinds = new Set(Object.values(C.TutorialHints).map(h => h.kind));
  ok('四种提示类型齐全（按键/说明/独白）', kinds.size === 3, [...kinds].join(','));
  ok('触发表一共 22 条', Object.keys(C.TutorialHints).length === 22);
}

section('7. 教学结束 = UI 永久消失');
{
  const N = C.Notebook.reset();
  const t = new C.TimeSystem(); t.day = 2;
  C.Tutorial.reset(true);
  C.Tutorial.setObjective('leave');
  ok('结束前有目标', C.Tutorial.objective === 'leave');

  C.Tutorial.finish(N, t);
  ok('目标没了', C.Tutorial.objective === null);
  ok('提示系统关了', C.Tutorial.enabled === false);
  ok('再触发任何提示都不出来', !C.Tutorial.hint('T01', 0) && !C.Tutorial.hint('T09', 0));
  ok('再设目标也没用', !C.Tutorial.setObjective('drink'));
  /* **没有任何庆祝、没有「教学完成」字样。**
     只是没有人再告诉你该干什么了。 */
  ok('笔记本记一条「离开宿舍楼」', N.clues.some(c => c.text === '离开宿舍楼'));
  ok('而且是第 2 天', N.clues[0].day === 2);
}

section('8. 跳过教学：关卡布置不变');
{
  const a = campus();
  const before = a.level.zombieSpawns.length;
  const lockedBefore = a.level.zombieSpawns.filter(z => z.lockedIn).length;

  C.Tutorial.reset(true);
  C.Tutorial.skip();
  ok('提示全关', C.Tutorial.enabled === false && C.Tutorial.pending.length === 0);
  ok('没有目标', C.Tutorial.objective === null);

  const b = campus();
  /* **不要做一个「教学地图」和一个「正式地图」两套东西。教学就是游戏的第一天。** */
  ok('205 的丧尸还在', b.level.zombieSpawns.filter(z => z.lockedIn).length === lockedBefore);
  ok('一楼的巡逻者还在',
     b.level.zombieSpawns.some(z => z.tutorialRole === 'patrol1F'));
  ok('丧尸总数不变', b.level.zombieSpawns.length === before);
  ok('402 的电水壶还在', b.level.containers.some(c => c.roomName === '男402' && c.grid.find('kettle')));
}

section('9. 一楼的结构保证玩家跑得掉');
{
  const s = campus();
  const home = s.level.buildings.find(b => b.spec.spawn);
  const m0 = home.floorsMeta[0];
  const cb = m0.corridor.bounds;
  const len = cb.max.x - cb.min.x;
  ok('一楼走廊足够长', len > 20, len.toFixed(1) + 'm');
  ok('**两端各有一个楼梯**（刻意的：被惊动了可以绕另一边）',
     m0.stairs.length === 2, String(m0.stairs.length));

  /* 丧尸游荡 0.45 m/s，玩家奔跑 4.6 m/s ——
     **结构上保证玩家永远能跑掉。失败是允许的，死亡不应该发生。** */
  const zSpeed = C.Config.zombieTypes.Wanderer.speedWander;
  const pSpeed = C.Config.player.speedRun;
  ok('玩家跑得比丧尸游荡快得多', pSpeed / zSpeed > 8, (pSpeed / zSpeed).toFixed(1) + '倍');
  const worst = (len / 2) / pSpeed;
  ok('从走廊中点跑到最近的楼梯不超过 4 秒', worst < 4, worst.toFixed(1) + 's');
  ok('**不做隐形无敌帧** —— 用关卡结构保证可恢复性', C.Config.debug.godMode === false);
}

section('10. 存档往返');
{
  C.Tutorial.reset(true);
  C.Tutorial.setObjective('sound');
  C.Tutorial.completeObjective('drink');
  C.Tutorial.hint('T09', 3);
  const raw = JSON.parse(JSON.stringify(C.Tutorial.serialize()));
  C.Tutorial.reset(true);
  C.Tutorial.deserialize(raw);
  ok('当前目标还原', C.Tutorial.objective === 'sound');
  ok('已完成的目标还原', C.Tutorial.done.drink === true);
  ok('已出现过的提示还原（读档不会重播一遍）',
     !C.Tutorial.hint('T09', 3.5), JSON.stringify(C.Tutorial.shown));
}

section('11. 常驻目标卡片：去哪儿 + 怎么办');
{
  C.Tutorial.reset(true);
  const c = C.Tutorial.card();
  ok('开局就有卡片', !!c);
  ok('第一条是「找点喝的」', c.text.indexOf('喝的') >= 0, c.text);
  ok('进度是 1 / 7', c.progress.index === 1 && c.progress.total === 7, JSON.stringify(c.progress));

  /* **教学全程都在同一栋宿舍楼里，所以位置能写死。**
     每一条目标都必须给出楼层 —— 新手不知道自己在几楼。 */
  let missing = [];
  for (const o of C.TutorialObjectives) {
    if (!o.where) missing.push(o.id + ':没写地点');
    else if (!/[一二三四]楼/.test(o.where)) missing.push(o.id + ':地点没写楼层');
    if (!o.hints || o.hints.length !== 2) missing.push(o.id + ':提示不是两句');
  }
  ok('七个目标都有「几楼·哪间」和两句提示', missing.length === 0, missing.join(' / '));

  // 提示要能教会按键；独白不能带按键（那是角色在想事情，不是系统在说话）
  const keyed = C.TutorialObjectives.filter(o => /按/.test(o.hints.join('')));
  ok('大多数提示直接告诉玩家按哪个键', keyed.length >= 5, keyed.length + ' / 7');
  const badMono = C.TutorialObjectives.filter(o => /按\s?[A-Z]/.test(o.text));
  ok('独白里没有按键指令（语气不能混）', badMono.length === 0, badMono.map(o => o.id).join());
}

section('12. 第二句提示只往前走，且不会被跳过');
{
  C.Tutorial.reset(true);
  const first = C.Tutorial.hintText();
  ok('先给第一句', first.indexOf('衣柜') >= 0, first);
  ok('推进成功', C.Tutorial.advanceStage(1) === true);
  ok('换成第二句', C.Tutorial.hintText() !== first, C.Tutorial.hintText());
  ok('**再推进是空操作**（只有两句，不能越界）', C.Tutorial.advanceStage(1) === false);
  ok('也不能回退', C.Tutorial.advanceStage(0) === false && C.Tutorial.stage === 1);

  // 换目标 → 阶段归零
  C.Tutorial.completeObjective('drink');
  C.Tutorial.setObjective('bag');
  ok('换目标后回到第一句', C.Tutorial.stage === 0 &&
     C.Tutorial.hintText().indexOf('六格') >= 0, C.Tutorial.hintText());

  /* **别把第二句挂在会同时完成该目标的条件上。**
     背上包就完成 bag、按下 Z 就完成 sound —— 那两句提示会永远看不到。
     所以这两条的第二句必须讲「还没做到时」的事。 */
  const bag = C.TutorialObjectives.find(o => o.id === 'bag');
  ok('bag 的第二句是「还没找到包」时的话', /衣柜|口袋/.test(bag.hints[1]), bag.hints[1]);
  const snd = C.TutorialObjectives.find(o => o.id === 'sound');
  ok('sound 的第二句是「还没屏息」时的话', /跑/.test(snd.hints[1]), snd.hints[1]);
}

section('13. 打勾：只给玩家正看着的那一条');
{
  C.Tutorial.reset(true);
  C.Tutorial.take();
  C.Tutorial.completeObjective('drink');
  let kinds = C.Tutorial.take().map(x => x.kind);
  ok('完成当前目标 → 出打勾', kinds.indexOf('objective-done') >= 0, kinds.join());

  // 后台顺手补完的目标不该抢画面（推上闸会同时把「烧点开水」也标完）
  C.Tutorial.setObjective('breaker');
  C.Tutorial.take();
  C.Tutorial.completeObjective('boil');
  kinds = C.Tutorial.take().map(x => x.kind);
  ok('补完别的目标 → 不出打勾', kinds.indexOf('objective-done') < 0, kinds.join());
  ok('当前目标没被顶掉', C.Tutorial.objective === 'breaker');
}

section('14. 卡片跟着教学一起消失');
{
  C.Tutorial.reset(true);
  ok('教学中有卡片', C.Tutorial.card() !== null);
  C.Tutorial.finish(null, null);
  ok('**结束后卡片是 null** —— 从现在起没人告诉你该干什么了', C.Tutorial.card() === null);
  C.Tutorial.reset(true);
  C.Tutorial.skip();
  ok('跳过教学也没有卡片', C.Tutorial.card() === null);
  ok('跳过后阶段归零', C.Tutorial.stage === 0);
}

section('15. 卡片状态进存档');
{
  C.Tutorial.reset(true);
  C.Tutorial.advanceStage(1);
  const raw = JSON.parse(JSON.stringify(C.Tutorial.serialize()));
  C.Tutorial.reset(true);
  C.Tutorial.deserialize(raw);
  ok('读档后还在第二句（不会倒回去重讲一遍）', C.Tutorial.stage === 1);
  ok('读档后卡片能画出来', C.Tutorial.card().hint === C.Tutorial.hintText());
}

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + `${pass} 通过 / ${fail} 失败\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
