/*
 * 世界交互的无头测试。跑法：node test/sim-world.js
 *
 * 盯四件事，每一件都是「玩家能不能真的做到」，不是「代码有没有这个函数」：
 *   ① 楼里真的有插座，而且插座属于所在楼的回路
 *   ② 放下的东西必须能再捡起来（**丢弃不等于销毁**）
 *   ③ 快取栏六格的内容能被界面层读出来
 *   ④ 插上加热设备就地变成灶台 —— 否则电水壶插上了也烧不了水
 */
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['03-math', '00-config', '01-eventbus', '02-modifiers', '04-soundgraph',
                 '05-soundsystem', '06-hearing', '07-time', '08-level', '09-collision',
                 '18-needs', '21-items', '22-loot', '10-player', '11-zombie',
                 '24-campus', '25-streaming', '26-notebook',
                 '29-power', '30-cooking', '31-tutorial', '33-traits', '35-outlets',
                 '19-sleep', '20-save', '38-placement']) require(path.join(SRC, f + '.js'));
const C = globalThis.Campus;

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '  → ' + e : '')); } };
const section = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

function world_() {
  C.SoundSystem.reset(); C.ZombieManager.reset(); C.ModifierPipeline.clear(); C.EventBus.clear();
  C.Loadout.reset().selectCharacter('student'); C.Loadout.apply();
  const level = C.buildCampus({ spawn: C.Loadout.spawn(), tutorial: true });
  C.placeCampusContainers(level); C.placeCampusLooseItems(level);
  const w = new C.World(level);
  const time = new C.TimeSystem();
  C.SoundSystem.init(level.graph, time, (a, b) => w.lineOfSight(a, b));
  C.Streaming.reset(level); C.Power.reset(level); C.Cooking.reset(); C.Outlets.reset();
  C.Placement.reset();
  const player = new C.Player(level, w);
  return { level, world: w, time, player };
}

section('1. 楼里真的有插座');
{
  const { level } = world_();
  ok('插座不是空的', (level.outlets || []).length > 0, String((level.outlets || []).length));

  /* **每一栋楼、每一层都要有。** 只在一楼放的话，
     「四楼醒来，水壶插哪儿」这个问题第一分钟就无解。 */
  const gaps = [];
  for (const b of level.buildings) {
    for (let f = 0; f < b.floorsMeta.length; f++) {
      const n = level.outlets.filter(o => o.id.indexOf('oc-' + b.spec.id + '-' + f + '-') === 0).length;
      if (n === 0) gaps.push(b.spec.id + ' 的第 ' + f + ' 层没有插座');
    }
  }
  ok('每栋楼每一层都有插座', gaps.length === 0, gaps.slice(0, 3).join(' / '));

  /* **分闸是按楼层的**：一栋楼一个配电箱，里面每层一个闸。
     `[实测]` 原来是「一栋楼一条回路」，出生楼那条断着 ——
     于是玩家在宿舍楼里走遍四层，32 个插座全是死的，
     他学到的不是「要去推闸」，是「这游戏的插座没做完」。 */
  const home = level.outlets.filter(o => /^circuit-dormM-/.test(o.circuitId));
  ok('宿舍楼的插座都挂在宿舍楼各层的回路上', home.length > 0, String(home.length));
  const floors = new Set(home.map(o => o.circuitId));
  ok('四层楼四条回路', floors.size === 4, [...floors].join(','));
  ok('出生的 402 那间有插座', level.outlets.some(o => /男402/.test(o.id)));

  // 插座贴墙、离地 0.35m —— 太高会插到天上，太低会埋进地板
  const bad = level.outlets.filter(o => Math.abs((o.pos.y % C.Config.level.floorHeight) - 0.35) > 0.01);
  ok('插座都在离地 0.35m 的墙上', bad.length === 0, String(bad.length));
}

section('2. 插座没电 = 闸没推（教学目标 3 的全部内容）');
{
  const { level, player } = world_();
  const o = level.outlets.find(x => /男402/.test(x.id));
  ok('出生那一层的闸是断的，所以这个插座没电', C.Outlets.powered(o) === false);

  /* **开局绝大多数插座是有电的。** 只有出生的那一层是断的 ——
     下一层楼的插座就是好的，玩家立刻知道「不是水壶坏了，是我这层没电」。 */
  const dead = level.outlets.filter(x => !C.Outlets.powered(x));
  ok('全校只有出生那一层没电', dead.length === 8 &&
     dead.every(x => /^oc-dormM-3-/.test(x.id)), dead.length + ' / ' + level.outlets.length);
  ok('楼下一层的插座是好的',
     C.Outlets.powered(level.outlets.find(x => /^oc-dormM-2-/.test(x.id))) === true);

  const r = player.useOutlet(o);
  /* **闸没推的时候照样插得上，只是没反应。**
     在这里拦住玩家（「这个插座没电，插不了」）就把整个教学目标毁了 ——
     他需要的是「插上了，什么也没发生」，那句话会把他推向一楼配电间。 */
  ok('没电也能插上去', r.ok === true, r.msg);
  ok('但会说清楚没反应', /没电/.test(r.msg), r.msg);
  ok('插座上确实挂着东西了', C.Outlets.at(o) !== null);

  C.Power.setBreaker('circuit-dormM-3', true, null, -1);
  ok('推上闸 → 插座有电了', C.Outlets.powered(o) === true);
  const rec = C.Outlets.at(o);
  ok('设备能开起来了', C.Power.setDevice(rec.link, rec.deviceId, true).ok === true);
}

section('3. 插上加热设备就地变成灶台');
{
  const { level, player } = world_();
  C.Power.setBreaker('circuit-dormM-3', true, null, -1);
  const o = level.outlets.find(x => /男402/.test(x.id));
  ok('插之前一个灶台也没有', C.Cooking.stations.length === 0);
  player.useOutlet(o);
  /* 不这样做的话，玩家插上电水壶之后还得再找一个「台面」才能烧水 ——
     那一步在现实里并不存在，只会让人以为水壶坏了。 */
  ok('插上电水壶 → 就地多了一个灶台', C.Cooking.stations.length === 1);
  const st = C.Cooking.stations[0];
  ok('灶台就在插座那个位置', C.V.dist(st.pos, o.pos) < 0.01);
  ok('灶台的热源就是电水壶', st.heater === 'kettle');
  ok('而且它接在这条链路上', st.link === C.Outlets.at(o).link);

  const chk = C.Cooking.canCook(C.Config.recipes.find(r => r.id === 'boilWater'), st);
  ok('站在这个灶台前能烧水了', chk.ok === true, chk.why);

  // 拔下来 → 灶台一起消失，东西回到身上
  const before = player.hotbar.filter(Boolean).length;
  const r = C.Outlets.unplug(o, player);
  ok('拔下来', r.ok === true, r.msg);
  ok('灶台跟着消失', C.Cooking.stations.length === 0);
  ok('水壶回到身上', player.hotbar.filter(Boolean).length === before + 1);
}

section('4. 放下的东西必须能再捡起来');
{
  const { level, player } = world_();
  const it = player.hotbar.find(Boolean);
  const id = it.id, n0 = (level.looseItems || []).length;

  const r = player.dropItem(it);
  ok('放下成功', r.ok === true, r.msg);
  /* **丢弃不等于销毁。** 之前背包界面的「丢掉」是直接把物品删掉 ——
     于是玩家永远不敢按它，而背包只有几十格、负重上限 20kg，
     「放下点东西再回来拿」本该是每天都要做的决定。 */
  ok('东西落在地上，没有凭空消失', level.looseItems.length === n0 + 1);
  const loose = level.looseItems[level.looseItems.length - 1];
  ok('落在脚边（1.5 米内）', C.V.distXZ(loose.pos, player.pos) < 1.5,
     C.V.distXZ(loose.pos, player.pos).toFixed(2));
  ok('还没被捡走', loose.taken === false);

  player.pickUp(loose);
  ok('走过去能捡回来', loose.taken === true);
  ok('回到身上了', player.hotbar.some(x => x && x.id === id) ||
     (player.bag && player.bag.items.some(x => x.id === id)));

  // 放下会响，而且重的东西更响
  const heard = [];
  C.EventBus.subscribe(C.Events.SoundEmitted, (e) => { if (e.label && /放下/.test(e.label)) heard.push(e); });
  player.hotbar[0] = C.makeItem('stone', 1);       // 0.25kg
  player.dropItem(player.hotbar[0]);
  player.hotbar[0] = C.makeItem('wok', 1);         // 2.2kg
  player.dropItem(player.hotbar[0]);
  ok('放下有声音', heard.length === 2, String(heard.length));
  /* **扔一口铁锅和放下一张纸不该一样响。** */
  ok('铁锅比石头响', heard[1].loudness > heard[0].loudness,
     heard[0].loudness + ' → ' + heard[1].loudness);
  ok('但都远低于翻找的 40', heard[1].loudness < C.Config.loudness.lootFast);
}

section('5. 捡放不会把物品变没或变多');
{
  const { level, player } = world_();
  const count = () => {
    let n = player.hotbar.filter(Boolean).length;
    if (player.bag) n += player.bag.items.length;
    return n + (level.looseItems || []).filter(l => !l.taken && l.dropped).length;
  };
  const n0 = count();
  const it = player.hotbar.find(Boolean);
  const r = player.dropItem(it);
  ok('放下后总数不变', count() === n0, count() + ' vs ' + n0);
  player.pickUp(r.loose);
  ok('捡回来后总数还是不变', count() === n0, count() + ' vs ' + n0);
}

section('6. 快取栏的内容界面层读得到');
{
  const { player } = world_();
  ok('六格', player.hotbar.length === 6);
  const shown = player.hotbar.map(it => it ? C.ITEMS[it.id].name : null).filter(Boolean);
  ok('学生开局手上有东西', shown.length > 0, shown.join(','));
  ok('每件都有中文名（界面直接显示它）', shown.every(n => n && n.length > 0));
  ok('石头在里面 —— 否则按 G 什么也不发生', player.stoneCount() > 0);
}

section('7. 插座进出存档');
{
  const { level, player } = world_();
  C.Power.setBreaker('circuit-dormM-3', true, null, -1);
  const o = level.outlets.find(x => /男402/.test(x.id));
  player.useOutlet(o);
  const raw = JSON.parse(JSON.stringify(C.Outlets.serialize()));
  ok('存下了插着什么', raw.length === 1 && raw[0].itemId === 'kettle', JSON.stringify(raw));

  C.Cooking.reset(); C.Outlets.reset();
  ok('清空后没有灶台', C.Cooking.stations.length === 0);
  C.Outlets.deserialize(raw, level);
  ok('读档后插座上的东西回来了', C.Outlets.at(o) !== null);
  ok('灶台也跟着重建', C.Cooking.stations.length === 1);
}

section('8. 配电箱：玩家真的走得到、按得动');
{
  const { level, player } = world_();
  ok('每栋楼一个配电箱', level.panels.length === level.buildings.length,
     level.panels.length + ' / ' + level.buildings.length);
  const panel = level.panels.find(p => p.buildingKey === 'dormM');
  ok('配电箱在一层走廊', panel && panel.pos.y < C.Config.level.floorHeight, String(panel.pos.y));

  /* `[实测]` 在这之前 `panelAt` 只是一个存在数据里的坐标 ——
     **没有任何东西渲染它，也没有任何办法跟它交互。**
     教学目标 6「配电间在一楼」和插座一样，是做不到的：
     玩家一路潜行下到一楼，找到那个位置，发现那里什么也没有。 */
  // 朝向：forward = (−sin(yaw), −cos(yaw))，所以 yaw=0 是面朝 −z
  player.pos = { x: panel.pos.x, y: panel.pos.y - 1.0, z: panel.pos.z + 1.0 };
  player.yaw = 0; player.pitch = 0;
  const t = player.findTarget();
  ok('站到跟前能瞄到它', t && t.type === 'panel', t ? t.type : 'null');

  // 这个箱子里应该有这栋楼每一层的分闸
  const mine = [...C.Power.circuits.values()].filter(c => c.id.indexOf('circuit-dormM-') === 0);
  ok('箱子里是这栋楼四层的分闸', mine.length === 4, String(mine.length));

  const off = mine.find(c => !c.breakerOn);
  ok('出生那一层是拉下的', !!off && off.id === 'circuit-dormM-3', off && off.id);
  const heard = [];
  C.EventBus.subscribe(C.Events.SoundEmitted, (e) => { if (/电闸/.test(e.label || '')) heard.push(e); });
  const r = C.Power.setBreaker(off.id, true, panel.pos, player.id);
  ok('推得上', r.ok === true, r.msg);
  ok('推闸有声音，响度 25', heard.length === 1 &&
     heard[0].loudness === C.Config.power.breakerLoudness, JSON.stringify(heard.map(h => h.loudness)));
  ok('声音从配电箱这个位置发出去（站远点按不能规避）',
     C.V.dist(heard[0].worldPosition, panel.pos) < 0.01);
  ok('推完那一层的插座就有电了',
     C.Outlets.powered(level.outlets.find(o => /^oc-dormM-3-/.test(o.id))) === true);
}

section('9. 存档 v3：把 M3 的状态一起带走');
{
  const { level, player, time } = world_();
  const game = { player, time, level };
  // 造一点状态出来：推一层闸、插上水壶、放一件东西在地上
  C.Power.setBreaker('circuit-dormM-3', true, null, -1);
  const o = level.outlets.find(x => /男402/.test(x.id));
  player.useOutlet(o);
  const dropped = player.dropItem(player.hotbar.find(Boolean));
  C.Cooking.xp = 500;
  C.Tutorial.setObjective('boil');

  const raw = JSON.parse(JSON.stringify(C.Save.build(game)));
  ok('存档版本是 3', raw.version === 3, String(raw.version));
  ok('供电进存档', !!raw.power && raw.power.circuits.length === 36, raw.power && String(raw.power.circuits.length));
  ok('插座上插着什么进存档', raw.outlets.length === 1 && raw.outlets[0].itemId === 'kettle');
  ok('烹饪熟练度进存档', raw.cooking.xp === 500);
  ok('教学进度进存档', raw.tutorial.objective === 'boil');
  ok('角色与特性进存档', raw.loadout.characterId === 'student');
  /* **玩家放在地上的东西关卡里本来没有**，只记「被捡走了没有」是不够的，
     必须把它整个存下来，否则读档之后它凭空消失。 */
  ok('放在地上的东西整个存下来', raw.dropped.length === 1 &&
     raw.dropped[0].item.id === dropped.loose.item.id, JSON.stringify(raw.dropped));

  // 读回一个全新的世界
  const s2 = world_();
  const game2 = { player: s2.player, time: s2.time, level: s2.level };
  C.Save.apply(game2, raw);
  ok('读档还原了那一层的闸', C.Power.circuits.get('circuit-dormM-3').breakerOn === true);
  const o2 = s2.level.outlets.find(x => /男402/.test(x.id));
  ok('读档还原了插座上的水壶', C.Outlets.at(o2) !== null);
  /* **不能变成两条链路两个灶台。** 供电和烹饪各自的 deserialize 已经把它们造回来了，
     插座层只该「认领」，不该再插一遍。 */
  ok('灶台只有一个，没有翻倍', C.Cooking.stations.length === 1, String(C.Cooking.stations.length));
  ok('链路也没翻倍', C.Power.links.length === 1, String(C.Power.links.length));
  ok('烹饪熟练度还原', C.Cooking.xp === 500);
  ok('教学进度还原', C.Tutorial.objective === 'boil');
  ok('放在地上的东西回来了',
     (s2.level.looseItems || []).some(l => l.dropped && !l.taken), '');
  ok('角色还原', C.Loadout.characterId === 'student');
}

section('10. 从背包摆出来 → 拉线 → 插电 → 加水 → 烧开');
{
  /* **这条链子上的每一步都是玩家亲手做的，每一步都有独立的失败方式。**
     「线不够长」「这层的闸没推」「壶里没水」是三件不同的事 ——
     三种「按了没反应」如果长成一个样，玩家只会以为设备坏了。 */
  const { level, world, player, time } = world_();
  const P = C.Placement;
  const kettle = player.hotbar.find(x => x && x.id === 'kettle');
  ok('学生开局身上有电水壶', !!kettle);

  // ① 放置
  ok('电水壶可以放置', P.placeable('kettle') === true);
  ok('石头不能放置（它不是电器也不是锅）', P.placeable('stone') === false);
  ok('进入放置模式', P.begin(kettle).ok === true);
  // 站在房间中央、平视，往前应该能找到落点
  player.pitch = -0.5;
  P.update(player, world);
  ok('准星前方算得出落点', P.ghost.pos !== null, JSON.stringify(P.ghost));
  const before = player.hotbar.filter(Boolean).length;
  const put = P.confirm(player);
  ok('放下了', put.ok === true, put.msg);
  ok('**这一刻才从背包里扣掉**', player.hotbar.filter(Boolean).length === before - 1);
  ok('世界上多了一件', P.list.length === 1);
  const pl = put.placed;
  ok('加热设备落地就是一个灶台', !!pl.station && pl.station.heater === 'kettle');
  ok('自带水箱的设备水是空的', pl.station.water === 0);

  // ② 拉线
  ok('还没插电', P.blocker(pl) === '没插电', String(P.blocker(pl)));
  ok('拿起它自带的线', P.takeCable(pl).ok === true);
  ok('手上确实拿着线', P.cable && P.cable.placed === pl);

  /* 线长 1.8 米：**这是「灶台放哪」这个决定的全部约束。**
     它把「随手一摆」变成「要看着插座摆」。 */
  const far = level.outlets.find(o => C.V.dist(o.pos, pl.pos) > 5);
  const rFar = P.plugCableInto(far);
  ok('够不着的插座插不上', rFar.ok === false && /线不够长/.test(rFar.msg), rFar.msg);
  ok('还差多少米要说出来', /还差 [\d.]+ 米/.test(rFar.msg), rFar.msg);
  ok('插不上的时候线还在手里', P.cable !== null);

  // 把水壶挪到 402 的插座边上重放
  const o = level.outlets.find(x => /男402/.test(x.id));
  P.dropCable();
  P.takeBack(pl, player);
  const k2 = player.hotbar.find(x => x && x.id === 'kettle') ||
             (player.bag && player.bag.items.find(x => x.id === 'kettle'));
  P.begin(k2);
  P.ghost.pos = { x: o.pos.x + 0.6, y: o.pos.y - 0.3, z: o.pos.z + 0.4 };
  P.ghost.ok = true;
  const pl2 = P.confirm(player).placed;
  P.takeCable(pl2);
  const rOk = P.plugCableInto(o);
  ok('够得着就插得上', rOk.ok === true, rOk.msg);
  /* **闸没推照样插得上，只是没反应** —— 和 35-outlets 同一条规矩。 */
  ok('但这一层的闸没推，所以没电', /没电/.test(rOk.msg), rOk.msg);
  ok('插完线就不在手上了', P.cable === null);
  ok('现在缺的是电，不是别的', P.blocker(pl2) === '插着，但这条回路没电', String(P.blocker(pl2)));

  // ③ 推闸
  C.Power.setBreaker('circuit-dormM-3', true, null, -1);
  C.Power.setDevice(pl2.station.link, pl2.station.deviceId, true);
  ok('推上闸就通电了', P.powered(pl2) === true);
  /* **通电了还不会自己烧。** 这是这条流程里最后一个「以为坏了」的坑。 */
  ok('现在缺的是水', P.blocker(pl2) === '壶里没水', String(P.blocker(pl2)));
  const boilR = C.Config.recipes.find(r => r.id === 'boilWater');
  const chk = C.Cooking.canCook(boilR, pl2.station);
  ok('没水就烧不了，而且说得出为什么', chk.ok === false && /没水/.test(chk.why), chk.why);

  // ④ 加水
  const water = player.hotbar.find(x => x && x.id === 'water') ||
                (player.bag && player.bag.items.find(x => x.id === 'water'));
  ok('身上有水', !!water);
  ok('倒进去', P.addWater(pl2, player).ok === true);
  ok('水满了', pl2.station.water === 1);
  ok('再倒一次没意义', P.addWater(pl2, player).ok === false);
  ok('现在什么也不缺了', P.blocker(pl2) === null, String(P.blocker(pl2)));
  ok('可以烧了', C.Cooking.canCook(boilR, pl2.station).ok === true);

  // ⑤ 烧开 —— 全程要听得见
  const heard = [];
  C.EventBus.subscribe(C.Events.SoundEmitted, (e) => heard.push(e));
  const now = 9.0;
  ok('开烧', C.Cooking.start('boilWater', pl2.station, now, {}).ok === true);
  C.Cooking.emitProcessNoise(3);
  const boiling = heard.filter(e => e.category === C.SoundCategory.Boil);
  /* **烧水的过程声单独一类**：玩家在隔壁房间就该听得出「我那壶水还在烧」。 */
  ok('烧的过程有咕嘟声，且是 Boil 这一类', boiling.length === 1, String(boiling.length));
  ok('咕嘟声从水壶那个位置发出去', C.V.dist(boiling[0].worldPosition, pl2.station.pos) < 0.01);

  heard.length = 0;
  C.Cooking.update(now + 0.5, 0.5, level);
  const whistle = heard.filter(e => e.category === C.SoundCategory.Whistle);
  /* **水开了要能只靠耳朵判断出来。** 哨声是玩家人在别的房间时唯一的依据，
     所以它必须和游戏里其它任何声音都不一样（见 13-audio 的专门分支）。 */
  ok('水开了有一声哨响', whistle.length === 1, JSON.stringify(heard.map(h => h.category)));
  ok('哨响的响度就是电水壶的提示音 35',
     whistle[0].loudness === C.Config.cooking.heaters.kettle.done, String(whistle[0].loudness));
  ok('标签就写着「水开了」', whistle[0].label === '水开了', whistle[0].label);
  ok('烧完水箱空了 —— 下一壶要重新倒', pl2.station.water === 0, String(pl2.station.water));
  ok('电水壶自动断电了', pl2.station.link.devices[0].on === false);
}

section('11. 摆出来的东西进存档');
{
  const { level, world, player, time } = world_();
  const P = C.Placement;
  const o = level.outlets.find(x => /男402/.test(x.id));
  const kettle = player.hotbar.find(x => x && x.id === 'kettle');
  P.begin(kettle);
  P.ghost.pos = { x: o.pos.x + 0.5, y: o.pos.y - 0.3, z: o.pos.z + 0.3 };
  P.ghost.ok = true;
  const pl = P.confirm(player).placed;
  P.takeCable(pl); P.plugCableInto(o);
  C.Power.setBreaker('circuit-dormM-3', true, null, -1);
  P.addWater(pl, player);

  const game = { player, time, level };
  const raw = JSON.parse(JSON.stringify(C.Save.build(game)));
  ok('摆出来的东西进存档', raw.placed.length === 1 && raw.placed[0].itemId === 'kettle',
     JSON.stringify(raw.placed));
  ok('水位也存了', raw.placed[0].water === 1);
  ok('插在哪个插座上也存了', raw.placed[0].outletId === o.id);

  const s2 = world_();
  C.Save.apply({ player: s2.player, time: s2.time, level: s2.level }, raw);
  ok('读档后东西还在世界上', C.Placement.list.length === 1);
  ok('灶台没翻倍', C.Cooking.stations.length === 1, String(C.Cooking.stations.length));
  ok('链路没翻倍', C.Power.links.length === 1, String(C.Power.links.length));
  ok('水位还原', C.Placement.list[0].station.water === 1);
  ok('还插在那个插座上', C.Placement.list[0].outletId === o.id);
}

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + `${pass} 通过 / ${fail} 失败\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
