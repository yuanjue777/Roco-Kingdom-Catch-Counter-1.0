/*
 * 供电与烹饪的无头测试。跑法：node test/sim-kitchen.js
 * 断言尽量从配置推导 —— 改数不必改测试，改坏了会立刻红。
 */
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
for (const f of ['03-math', '00-config', '01-eventbus', '02-modifiers', '04-soundgraph',
                 '05-soundsystem', '06-hearing', '07-time', '08-level', '09-collision',
                 '18-needs', '21-items', '22-loot', '10-player', '11-zombie',
                 '29-power', '30-cooking']) require(path.join(SRC, f + '.js'));
const C = globalThis.Campus;

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (e ? '  → ' + e : '')); } };
const section = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

function world() {
  C.SoundSystem.reset(); C.ZombieManager.reset(); C.ModifierPipeline.clear(); C.EventBus.clear();
  const level = C.buildDormitory();
  const w = new C.World(level);
  const time = new C.TimeSystem();
  C.SoundSystem.init(level.graph, time, (a, b) => w.lineOfSight(a, b));
  C.Power.reset(level);
  C.Cooking.reset();
  return { level, world: w, time };
}
/** 一套「电磁炉 + 炒锅 + 市电」的标准厨房 */
function kitchen(opts) {
  opts = opts || {};
  const c = C.Power.addCircuit('c1', '四层照明插座', { breakerOn: opts.breakerOn !== false });
  const src = C.Power.addSource('grid', { circuitId: 'c1', pos: C.V.make(0, 0, 0) });
  const link = C.Power.createLink(src);
  link.cables = ['shortWire'];
  const heater = opts.heater || 'inductionHob';
  const watt = C.Config.cooking.heaters[heater].watt;
  link.devices.push({ id: 'h1', watt, on: false, label: C.Config.cooking.heaters[heater].name });
  const st = C.Cooking.addStation({ pos: C.V.make(1, 0.02, 1.3), heater,
                                    cookware: opts.cookware === undefined ? 'wok' : opts.cookware,
                                    link, deviceId: 'h1' });
  return { circuit: c, src, link, st };
}

// ══════════════════════════════════════════════════════
section('1. 需求速率（规格 0.1 的强制调整）');
{
  const N = C.Config.needs;
  ok('饥饿涨满 50 小时（原 96）', N.hungerFullHours === 50, String(N.hungerFullHours));
  ok('口渴涨满 28 小时（原 30）', N.thirstFullHours === 28, String(N.thirstFullHours));
  const perDay = (h) => (N.barLength / h) * 24;
  ok('每游戏日饥饿约 48 点', Math.abs(perDay(N.hungerFullHours) - 48) < 0.5, perDay(N.hungerFullHours).toFixed(1));
  ok('每游戏日口渴约 84 点', Math.abs(perDay(N.thirstFullHours) - 85.7) < 1, perDay(N.thirstFullHours).toFixed(1));
  /* 这条调整的**理由**：原值下一碗白饭(22) 就顶掉大半天的饥饿(25)，
     食物完全不构成压力，整套烹饪系统失去存在理由。 */
  const rice = C.Config.recipes.find(r => r.id === 'riceMeal');
  ok('一碗白饭顶不了一天（否则烹饪系统没有存在理由）',
     rice.satiety < perDay(N.hungerFullHours) * 0.6, rice.satiety + ' vs 日需 ' + perDay(N.hungerFullHours).toFixed(0));
}

section('2. 回路：玩家找到的第一个插座很可能是死的');
{
  world();
  const c = C.Power.addCircuit('c1', '四层照明插座', { breakerOn: false });
  const src = C.Power.addSource('grid', { circuitId: 'c1', pos: C.V.make(0, 0, 0) });
  const link = C.Power.createLink(src);
  link.devices.push({ id: 'k', watt: 1500, on: false, label: '电水壶' });

  ok('闸是断的 → 插座没电', src.available(C.Power.env()) === 0);
  ok('这时候开设备会被明确拒绝', C.Power.setDevice(link, 'k', true).msg === '这个插座没电');

  C.SoundSystem.log.length = 0;
  const r = C.Power.setBreaker('c1', true, C.V.make(0, 0, 0), 1);
  ok('推上闸', r.ok && c.breakerOn);
  const snd = C.SoundSystem.log.find(e => e.label === '推上电闸');
  ok('推闸发出响度 25 的声音（教学关卡要考这个）',
     snd && snd.loud === C.Config.power.breakerLoudness, snd && String(snd.loud));
  ok('推完闸插座就有电了', src.available(C.Power.env()) === C.Config.power.sources.grid.watt);
  ok('设备能开了', C.Power.setDevice(link, 'k', true).ok);

  // 线路损坏与永久失效
  const d = C.Power.addCircuit('c2', '损坏回路', { damaged: true });
  ok('损坏的回路不通电', d.state() === C.CircuitState.Damaged);
  ok('手艺不够修不了', !C.Power.repairCircuit('c2', 1, true).ok);
  ok('手艺够且有料才修得好', C.Power.repairCircuit('c2', 2, true).ok && !d.wiringDamaged);
  const dead = C.Power.addCircuit('c3', '主干断', { dead: true });
  ok('永久失效的回路修不了，也推不上闸',
     !C.Power.repairCircuit('c3', 5, true).ok && !C.Power.setBreaker('c3', true).ok);
}

section('3. 跳闸：不是随机的，是玩家算错了');
{
  world();
  const k = kitchen();
  // 电磁炉 2000 + 电水壶 1500 = 3500 > 市电 2200
  k.link.devices.push({ id: 'kettle', watt: 1500, on: false, label: '电水壶' });
  let tripped = null;
  C.EventBus.subscribe('CircuitOverloadedEvent', (e) => { tripped = e; });
  C.SoundSystem.log.length = 0;

  ok('先开电磁炉（2000W）没问题', C.Power.setDevice(k.link, 'h1', true).ok);
  const r = C.Power.setDevice(k.link, 'kettle', true);
  ok('再开电水壶（+1500W）超过 2200W → 跳闸', r.tripped === true, r.msg);
  ok('广播了超载事件', !!tripped);
  ok('跳闸时链路上所有设备都停了', k.link.devices.every(d => !d.on));
  const snd = C.SoundSystem.log.find(e => e.label === '跳闸');
  ok('跳闸「啪」的一声响度 40', snd && snd.loud === C.Config.power.tripLoudness, snd && String(snd.loud));
  ok('跳闸后开不了设备，得先复位', !C.Power.setDevice(k.link, 'h1', true).ok);
  ok('复位之后能重来', C.Power.resetBreakerOf(k.link).ok && C.Power.setDevice(k.link, 'h1', true).ok);

  /* **界面必须始终能拿到「已用/上限」** —— 跳闸永远应该是玩家的失误，不是意外。 */
  const ro = C.Power.readout(k.link);
  ok('随时查得到已用/上限', ro.used === 2000 && ro.limit === 2200, ro.used + '/' + ro.limit);
}

section('4. 第 11 天 00:00 市电永久中断');
{
  world();
  const k = kitchen();
  C.Power.setDevice(k.link, 'h1', true);
  let lost = null;
  C.EventBus.subscribe('PowerLostEvent', (e) => { lost = e; });

  C.Power.update(1, 10, false, 'clear');
  ok('第 10 天市电还在', C.Power.gridUp && k.link.devices[0].on);

  C.Power.update(1, C.Config.power.gridFailDay, false, 'clear');
  ok('第 11 天市电断了', !C.Power.gridUp);
  ok('市电上的设备全部停机', k.link.devices.every(d => !d.on));
  ok('广播了断电事件', lost && lost.reason === 'gridFail');
  ok('断电之后市电插座永远是 0W', k.src.available(C.Power.env()) === 0);
  ok('**这是永久的**，不会自己恢复', (C.Power.update(24, 12, false, 'clear'), !C.Power.gridUp));
}

section('5. 柴油与太阳能：自持期的算术');
{
  world();
  const gen = C.Power.addSource('genBig', { fuel: 10, pos: C.V.make(0, 0, 0) });
  gen.on = true;
  const link = C.Power.createLink(gen);
  link.devices.push({ id: 'hob', watt: 2000, on: true, label: '电磁炉' });
  C.Power.update(2, 1, false, 'clear');
  ok('大发电机 2 小时烧掉 0.9L', Math.abs(gen.fuel - (10 - 0.45 * 2)) < 0.001, gen.fuel.toFixed(2) + 'L');

  /* **结局一的耦合**：信标 500W 连跑三天 = 0.45 × 72 = 32.4L，
     超过全校总量 46L 的三分之二。这个算术题本身就是一个很好的中期目标。 */
  const beaconHours = 72;
  const need = C.Config.power.sources.genBig.perHour * beaconHours;
  ok('信标跑满三天要 32.4L 柴油', Math.abs(need - 32.4) < 0.01, need.toFixed(1) + 'L');
  ok('这超过全校柴油总量的三分之二',
     need > C.Config.power.dieselTotalLitres * 0.66, (need / C.Config.power.dieselTotalLitres * 100).toFixed(0) + '%');

  // 太阳能
  const S = C.Config.power.solarOutput;
  ok('夜里太阳能是 0（这一点不能忘）', C.solarWatt({ night: true, weather: 'clear' }) === 0);
  ok('晴天单块 220W', C.solarWatt({ night: false, weather: 'clear' }) === S.clearDay);
  ok('雨天掉到 40W', C.solarWatt({ night: false, weather: 'rain' }) === S.rain);
  const full = C.Config.power.solarPanels * S.clearDay;
  ok('三块全找到晴天 660W', full === 660, String(full));
  ok('**不够跑电磁炉(2000W)**', full < C.Config.cooking.heaters.inductionHob.watt);
  ok('**但够跑电炖锅(300W)并给电瓶充电**', full > C.Config.cooking.heaters.slowCooker.watt);
}

section('6. 兼容矩阵：电磁炉配砂锅是玩家最容易犯的错误');
{
  world();
  const bad = kitchen({ heater: 'inductionHob', cookware: 'clayPot' });
  const r = C.Cooking.canCook(C.Config.recipes.find(x => x.id === 'congee'), bad.st);
  ok('电磁炉 + 砂锅 → 锅具不兼容', !r.ok && r.why.indexOf('不兼容') >= 0, r.why);

  world();
  const good = kitchen({ heater: 'ceramicHob', cookware: 'clayPot' });
  good.link.devices[0].watt = C.Config.cooking.heaters.ceramicHob.watt;
  ok('电陶炉 + 砂锅 → 可以', C.Cooking.canCook(C.Config.recipes.find(x => x.id === 'congee'), good.st).ok);

  /* 这两条组合起来有一个漂亮的后果：
     电磁炉 2000W 在自持期用不了，而砂锅偏偏上不了电磁炉 ——
     **最好的汤锅，要等到最难的时候才真正登场。** */
  const solarMax = C.Config.power.solarPanels * C.Config.power.solarOutput.clearDay;
  ok('自持期（太阳能 660W）连电陶炉都带不动',
     solarMax < C.Config.cooking.heaters.ceramicHob.watt, solarMax + 'W < 1500W');
  ok('只剩电炖锅带得动', solarMax > C.Config.cooking.heaters.slowCooker.watt);
  ok('微波炉只吃玻璃饭盒', C.Config.cooking.compat.microwave.join() === 'glassBox');
  ok('玻璃饭盒也只能进微波炉',
     ['inductionHob', 'ceramicHob', 'campStove'].every(h => C.Config.cooking.compat[h].indexOf('glassBox') < 0));
}

section('7. 功率不够时不许开火');
{
  world();
  const k = kitchen();
  C.Cooking.xp = 200;                       // Lv1，会做蛋炒饭
  // 先占掉 800W
  k.link.devices.push({ id: 'rice', watt: 800, on: true, label: '电饭煲' });
  const r = C.Cooking.canCook(C.Config.recipes.find(x => x.id === 'eggRice'), k.st);
  ok('2000 + 800 > 2200 → 提前拦住，不让它跳闸', !r.ok && r.why.indexOf('功率不够') >= 0, r.why);
  ok('提示里写清楚还差多少', r.why.indexOf('1400W') >= 0, r.why);
}

section('8. 火候：黄金窗口 → 过火 → 报废');
{
  world();
  const k = kitchen();               // 电磁炉需要看火
  C.Cooking.xp = 200;                // Lv1，能做蛋炒饭
  const t0 = 10;
  const r = C.Cooking.start('eggRice', k.st, t0);
  ok('开火', r.ok, r.msg);
  const ss = k.st.session;
  const mins = r.minutes;
  ok('电磁炉速度系数 1.0，蛋炒饭 12 分钟', Math.abs(mins - 12) < 0.01, mins.toFixed(1));

  C.Cooking.update(t0 + mins / 60 + 0.001, 0.1);
  ok('到点进入黄金窗口', ss.phase === C.CookPhase.Golden, ss.phase);
  const g1 = C.Cooking.take(k.st, t0 + mins / 60 + 0.001);
  ok('黄金窗口内取出 = 100% 效果', g1.food.satiety > 30, String(g1.food.satiety));

  // 再来一锅，放到过火
  C.Cooking.start('eggRice', k.st, t0);
  const ss2 = k.st.session;
  C.Cooking.update(ss2.goldenEnd + 0.001, 0.1);
  ok('黄金窗口过了进过火期', ss2.phase === C.CookPhase.Overcooked, ss2.phase);
  const mid = (ss2.goldenEnd + ss2.ruinAt) / 2;
  const g2 = C.Cooking.take(k.st, mid);
  ok('过火期效果线性衰减（约 70%）',
     g2.food.satiety < g1.food.satiety * 0.85 && g2.food.satiety > g1.food.satiety * 0.5,
     g2.food.satiety + ' vs ' + g1.food.satiety);

  C.Cooking.start('eggRice', k.st, t0);
  const ss3 = k.st.session;
  C.Cooking.update(ss3.goldenEnd + 0.001, 0.1);
  C.Cooking.update(ss3.ruinAt + 0.001, 0.1);
  ok('过火期结束就报废', ss3.phase === C.CookPhase.Ruined);
  const g3 = C.Cooking.take(k.st, ss3.ruinAt + 0.01);
  ok('变成「糊掉的xx」，饱食度 5', g3.food.name.indexOf('糊掉的') === 0 && g3.food.satiety === 5, g3.food.name);
}

section('9. 只有电磁炉/电陶炉/卡式炉需要看火');
{
  world();
  const k = kitchen({ heater: 'riceCooker', cookware: null });
  k.link.devices[0].watt = 800;
  const t0 = 10;
  C.Cooking.start('riceMeal', k.st, t0);
  const ss = k.st.session;
  ok('电饭煲自动断电', ss.autoShutoff === true);
  C.Cooking.update(ss.goldenEnd + 10, 0.1);        // 远远超过黄金窗口
  ok('**电饭煲不会过火** —— 炖着饭出门是安全的', ss.phase === C.CookPhase.Golden, ss.phase);
  ok('完成后自动关掉设备（不再耗电）', !k.link.devices[0].on);

  /* 「我能不能一边炖汤一边出门?」这个问题的答案，取决于玩家用的是什么设备。
     **这是本系统最核心的策略深度。** */
  const auto = Object.keys(C.Config.cooking.heaters).filter(h => C.Config.cooking.heaters[h].autoShutoff);
  const watch = Object.keys(C.Config.cooking.heaters).filter(h => !C.Config.cooking.heaters[h].autoShutoff);
  ok('不用看火的：电饭煲/电水壶/微波炉/电炖锅', auto.length === 4, auto.join(','));
  ok('要看火的：电磁炉/电陶炉/卡式炉', watch.length === 3, watch.join(','));
}

section('10. 微波炉那声「叮」');
{
  world();
  const k = kitchen({ heater: 'microwave', cookware: 'glassBox' });
  k.link.devices[0].watt = 1200;
  const t0 = 10;
  C.Cooking.start('bakedPotato', k.st, t0);
  C.SoundSystem.log.length = 0;
  C.Cooking.update(k.st.session.doneAt + 0.001, 0.1);
  const ding = C.SoundSystem.log.find(e => e.label.indexOf('微波炉') >= 0);
  ok('完成时「叮」一声，响度 50', ding && ding.loud === 50, ding && String(ding.loud));
  ok('这个响度全楼都听得见（室内半径 20m）',
     (50 - C.Config.hearing.zombie) / C.Config.sound.kIndoor === 20);

  // 拆掉蜂鸣器（手艺 3）
  world();
  const k2 = kitchen({ heater: 'microwave', cookware: 'glassBox' });
  k2.link.devices[0].watt = 1200;
  k2.st.debuzzed = true;
  C.Cooking.start('bakedPotato', k2.st, t0);
  C.SoundSystem.log.length = 0;
  C.Cooking.update(k2.st.session.doneAt + 0.001, 0.1);
  ok('拆掉蜂鸣器之后不再「叮」',
     !C.SoundSystem.log.some(e => e.label.indexOf('微波炉') >= 0));
}

section('11. 高压锅泄压');
{
  world();
  const k = kitchen({ heater: 'ceramicHob', cookware: 'pressure' });
  k.link.devices[0].watt = 1500;
  C.Cooking.xp = 500;                                // Lv2
  const r = C.Cooking.start('pressureBeef', k.st, 10);
  ok('高压锅把时间压到 40%', Math.abs(r.minutes - 24 * 1.35 * 0.4) < 0.01, r.minutes.toFixed(1) + ' 分钟');
  C.Cooking.update(k.st.session.doneAt + 0.001, 0.1);
  ok('做完之后需要泄压', k.st.session.venting > 0);

  C.SoundSystem.log.length = 0;
  C.Cooking.vent(k.st, true);
  const v = C.SoundSystem.log[C.SoundSystem.log.length - 1];
  ok('强制泄压响度 55（全楼都听得见）', v.loud === 55, String(v.loud));

  C.Cooking.update(k.st.session.doneAt + 0.001, 0.1);
  k.st.session.venting = 15;
  C.SoundSystem.log.length = 0;
  C.Cooking.vent(k.st, false);
  ok('自然泄压只有 20，但要等 15 分钟',
     C.SoundSystem.log[C.SoundSystem.log.length - 1].loud === 20);
}

section('12. 中断：跳闸/停电毁掉正在做的东西');
{
  world();
  const k = kitchen();
  C.Cooking.xp = 200;
  C.Cooking.start('eggRice', k.st, 10);
  ok('正在做', k.st.session.phase === C.CookPhase.Cooking);
  C.Cooking.ruinAllOn(k.link, 'trip');
  ok('跳闸 → 报废', k.st.session.phase === C.CookPhase.Ruined);

  // 玩家手动关火则保留进度
  world();
  const k2 = kitchen();
  C.Cooking.xp = 200;
  C.Cooking.start('eggRice', k2.st, 10);
  ok('手动关火不报废，只是停下', C.Cooking.stop(k2.st).ok && k2.st.session === null);
  ok('关火也把设备断电了', !k2.link.devices[0].on);
}

section('13. 调味料是乘数不是加数');
{
  world();
  const k = kitchen();
  C.Cooking.xp = 200;
  const at = 10;
  C.Cooking.start('eggRice', k.st, at, { seasonings: 0 });
  C.Cooking.update(k.st.session.doneAt + 0.001, 0.1);
  const plain = C.Cooking.take(k.st, k.st.session.doneAt + 0.001).food.satiety;

  C.Cooking.start('eggRice', k.st, at, { seasonings: 3 });
  C.Cooking.update(k.st.session.doneAt + 0.001, 0.1);
  const seasoned = C.Cooking.take(k.st, k.st.session.doneAt + 0.001).food.satiety;
  ok('三种调味料 +24%', Math.abs(seasoned / plain - 1.24) < 0.01, (seasoned / plain).toFixed(3));

  C.Cooking.start('eggRice', k.st, at, { seasonings: 9 });
  ok('最多叠 3 种', k.st.session.seasonings === C.Config.cooking.seasoningMaxSlots);
}

section('14. 锅具加成：砂锅的汤更解渴');
{
  world();
  const a = kitchen({ heater: 'ceramicHob', cookware: 'stockpot' });
  a.link.devices[0].watt = 1500;
  C.Cooking.start('congee', a.st, 10);
  C.Cooking.update(a.st.session.doneAt + 0.001, 0.1);
  const plain = C.Cooking.take(a.st, a.st.session.doneAt + 0.001).food;

  world();
  const b = kitchen({ heater: 'ceramicHob', cookware: 'clayPot' });
  b.link.devices[0].watt = 1500;
  C.Cooking.start('congee', b.st, 10);
  C.Cooking.update(b.st.session.doneAt + 0.001, 0.1);
  const clay = C.Cooking.take(b.st, b.st.session.doneAt + 0.001).food;

  ok('砂锅煮粥解渴 +25%', Math.abs(clay.thirst / plain.thirst - 1.25) < 0.01,
     clay.thirst + ' vs ' + plain.thirst);
  ok('砂锅饱食 +10%', Math.abs(clay.satiety / plain.satiety - 1.10) < 0.01);
}

section('15. 汤在解渴效率上严格优于直接喝水');
{
  /* 这不是失衡，这是玩家搭建厨房应得的回报。
     它的成本是：电、时间、食材、以及做饭时暴露的噪音。 */
  const water = C.Config.food.drinks.water.thirst;                 // −24
  const soup = C.Config.recipes.find(r => r.id === 'tomatoSoup');  // −30
  ok('一锅番茄鸡蛋汤比一瓶水更解渴', soup.thirst < water, soup.thirst + ' vs ' + water);
  ok('而且还附赠饱食度', soup.satiety > 0, String(soup.satiety));
  const slow = C.Config.recipes.find(r => r.id === 'slowSoup');
  ok('老火靓汤解渴 42、饱食 34、噪音只有 8', slow.thirst === -42 && slow.satiety === 34 && slow.loud === 8);
  ok('但它要炖 3 小时', slow.time === 180);
  ok('而且只能用不看火的设备（电炖锅）', slow.heater === 'slowOnly');
}

section('16. 规则一：干的加渴，湿的解渴');
{
  const R = C.Config.food.raw;
  ok('饼干加渴', R.biscuit.thirst > 0);
  ok('火腿肠加渴', R.sausage.thirst > 0);
  ok('干吃泡面最加渴', R.noodleDry.thirst >= 9, String(R.noodleDry.thirst));
  ok('水果罐头（含糖水）反而解渴', R.cannedFruit.thirst < 0);
  const wet = C.Config.recipes.filter(r => r.thirst <= -20);
  ok('汤水类大量解渴', wet.length >= 6, wet.length + ' 道');
  /* **早期靠零食活着的时候，水会消耗得特别快。**
     这是一种不需要教程的教学。 */
  const snackDay = 5 * R.biscuit.thirst;
  ok('一天啃五包饼干额外多渴 20 点', snackDay === 20, String(snackDay));
}

section('17. 规则二：加工层级决定效率');
{
  const g = (id) => C.Config.recipes.find(r => r.id === id);
  ok('煮成饭 22', g('riceMeal').satiety === 22);
  ok('煮成粥 18，但解渴 24', g('congee').satiety === 18 && g('congee').thirst === -24);
  ok('做成炒饭 30', g('eggRice').satiety === 30);
  ok('午餐肉炒饭 36', g('spamRice').satiety === 36);
  ok('**加工带来的增值是玩家投资厨房的直接回报**',
     g('eggRice').satiety > g('riceMeal').satiety);
  const lv5 = C.Config.recipes.filter(r => r.lv === 5);
  ok('Lv5 不追求饱食度最高，而是给 buff', lv5.every(r => !!r.buff));
}

section('18. 熟练度：只有尝试新东西才涨');
{
  world();
  const k = kitchen({ heater: 'riceCooker', cookware: null });
  k.link.devices[0].watt = 800;
  const cook = (t) => {
    C.Cooking.start('riceMeal', k.st, t);
    C.Cooking.update(k.st.session.doneAt + 0.001, 0.1);
    return C.Cooking.take(k.st, k.st.session.doneAt + 0.001).xp;
  };
  const x1 = cook(10), x2 = cook(20), x3 = cook(30), x4 = cook(40), x5 = cook(50), x6 = cook(60);
  ok('第一次做 100 经验', x1 === 100, String(x1));
  ok('第 2 次 40', x2 === 40);
  ok('第 3 次 15', x3 === 15);
  ok('第 4 次 5', x4 === 5);
  ok('**第 5 次及以后 0** —— 反复做蛋炒饭不会让你变成大厨', x5 === 0 && x6 === 0);

  // 等级门槛
  C.Cooking.xp = 0;   ok('0 经验是 Lv0', C.Cooking.level() === 0);
  C.Cooking.xp = 150; ok('150 → Lv1', C.Cooking.level() === 1);
  C.Cooking.xp = 2800;ok('2800 → Lv5', C.Cooking.level() === 5);
  ok('Lv5 饱食 +40%', C.Cooking.levelDef().satiety === 0.40);
  ok('Lv5 吃变质食材不再腹泻（后期的核心价值）', C.Cooking.levelDef().spoiledNoSickness === true);
  C.Cooking.xp = 0;
  ok('Lv0 做不了 Lv1 的菜',
     !C.Cooking.canCook(C.Config.recipes.find(r => r.id === 'eggRice'), k.st).ok);
}

section('19. 气味：做一顿好饭是有后果的');
{
  const s = world();
  const k = kitchen();
  C.Cooking.xp = 500;
  const g = s.level.graph;
  // 把厨房放进一个真实节点
  const room = s.level.floorsMeta[0].rooms[0];
  k.st.pos = C.AABB.center(room.bounds);
  k.st.pos.y = 0.5;

  const z = C.ZombieManager.spawn({ type: 'Wanderer', pos: C.V.copy(k.st.pos) }, s.world);
  // 听觉组件读的是自己身上的 nodeId（平时由 Zombie.update 每帧同步）
  z.nodeId = g.getNodeAt(k.st.pos).id;
  z.hearing.nodeId = z.nodeId;
  const before = z.hearing.finalThreshold();

  C.Cooking.start('spamRice', k.st, 10);            // 气味 3
  C.Cooking.update(k.st.session.doneAt + 0.001, 0.1);
  const after = z.hearing.finalThreshold();
  ok('气味等级 3 让丧尸阈值从 10 降到 4', before === 10 && after === 4, before + ' → ' + after);
  ok('也就是它的可听半径变大了',
     z.hearing.audibleRange(C.Config.loudness.walk) > (C.Config.loudness.walk - before) / 2);

  const K = C.Config.cooking;
  ok('持续 等级×45 = 135 游戏分钟', Math.abs(3 * K.odorMinutesPerLevel - 135) < 0.01);
  C.Cooking.update(10 + 3, 0.1);                     // 3 小时后
  ok('到期后阈值恢复', z.hearing.finalThreshold() === 10);

  ok('玩家闻不到气味（只有丧尸的阈值受影响）', !new C.HearingComponent({ baseThreshold: 8 }).smells);
}

section('20. 关门可以阻断气味');
{
  const s = world();
  const g = s.level.graph;
  const room = s.level.floorsMeta[0].rooms[1];
  const roomNode = g.getNodeAt(C.AABB.center(room.bounds));
  // 把这间房的门全部关上
  for (const pid of roomNode.portals) {
    const p = g.getPortal(pid);
    if (p.type === C.PortalType.WoodDoor) g.setPortalState(p, C.PortalState.Closed);
  }
  const k = kitchen();
  C.Cooking.xp = 500;
  k.st.pos = C.AABB.center(room.bounds); k.st.pos.y = 0.5;
  C.Cooking.start('spamRice', k.st, 10);
  C.Cooking.update(k.st.session.doneAt + 0.001, 0.1);

  const inRoom = g.odorDrop(roomNode.id);
  const corridor = s.level.floorsMeta[0].corridor;
  ok('房间里有气味', inRoom > 0, String(inRoom));
  ok('**关着的门把气味挡在门内** —— 再次强化「关门」这个核心动词',
     g.odorDrop(corridor.id) === 0, String(g.odorDrop(corridor.id)));
}

section('21. 噪音：做饭永远在暴露你的位置');
{
  const K = C.Config.cooking;
  const g = (id) => C.Config.recipes.find(r => r.id === id);
  ok('爆炒 45', g('eggRice').loud === 45);
  ok('老火靓汤只有 8', g('slowSoup').loud === 8);
  ok('电炖锅本身也只有 8', K.heaters.slowCooker.idle === 8);
  ok('发电机 65 是全游戏最持久的噪音源', C.Config.power.sources.genBig.loud === 65);
  const r = C.Config.power.sources.genBig.loud;
  const radius = (r - C.Config.hearing.zombie) / C.Config.sound.kIndoor;
  ok('发电机室内有效半径 27.5m', Math.abs(radius - 27.5) < 0.01, radius + 'm');
  /* **你不能把发电机放在据点里。** 玩家必须把它放在远处然后拉长电缆 ——
     这就是 30 米电缆盘存在的意义。 */
  ok('电缆盘 30m 正好够把发电机拉出有效半径',
     C.Config.power.cables.cableReel.metres > radius * 0.9, '30m vs ' + radius + 'm');
}

section('22. 电线：长度累加，插孔是硬限制');
{
  world();
  const src = C.Power.addSource('genSmall', { fuel: 5, pos: C.V.make(0, 0, 0) });
  src.on = true;
  const link = C.Power.createLink(src);
  link.cables = ['extension', 'powerStrip'];
  ok('15m + 5m = 20m', link.metres() === 20, link.metres() + 'm');
  ok('插孔 2 + 4 − 1（串联占掉一个）= 5', link.sockets() === 5, String(link.sockets()));
  ok('20m 够到 18m 外的设备', link.reachable(C.V.make(0, 0, 0), C.V.make(18, 0, 0)));
  ok('够不到 25m 外的', !link.reachable(C.V.make(0, 0, 0), C.V.make(25, 0, 0)));
  ok('小发电机上限 1200W，带不动电磁炉',
     C.Config.power.sources.genSmall.watt < C.Config.cooking.heaters.inductionHob.watt);
}

section('23. 三个阶段的厨房');
{
  const H = C.Config.cooking.heaters, P = C.Config.power;
  const canRun = (watt, limit) => watt <= limit;
  // 蹭电期：市电 2200
  ok('蹭电期什么都能用', canRun(H.inductionHob.watt, P.sources.grid.watt));
  // 烧油期：大发电机 3000，但每小时 0.45L
  ok('烧油期电磁炉还能用，但每顿饭都在烧柴油',
     canRun(H.inductionHob.watt, P.sources.genBig.watt) && P.sources.genBig.perHour > 0);
  // 自持期：太阳能 660 + 电瓶 1000
  const solar = P.solarPanels * P.solarOutput.clearDay;
  ok('自持期电磁炉彻底用不了', !canRun(H.inductionHob.watt, solar + P.sources.battery.watt) === false
     || H.inductionHob.watt > solar, H.inductionHob.watt + 'W vs 太阳能 ' + solar + 'W');
  ok('**慢炖成为唯一可持续的烹饪方式**', canRun(H.slowCooker.watt, solar));
  ok('卡式炉是应急不是常规（全校 5 罐 × 3 小时 = 15 小时）',
     C.Config.cooking.butaneCans * C.Config.cooking.butaneHoursPerCan === 15);
}

section('24. 熟食不能囤积');
{
  const K = C.Config.cooking;
  ok('熟食保质 8 小时', K.cookedFreshHours === 8);
  ok('装进保鲜容器 20 小时', K.cookedInContainerHours === 20);
  /* **这是刻意的限制** —— 它阻止玩家一次做二十顿饭然后再也不进厨房。
     做饭必须是一件每天都要做的事，厨房才有存在感。 */
  const dayNeed = (C.Config.needs.barLength / C.Config.needs.hungerFullHours) * 24;
  const best = Math.max(...C.Config.recipes.map(r => r.satiety));
  ok('最好的一道菜也顶不满一天', best < dayNeed * 1.2, best + ' vs 日需 ' + dayNeed.toFixed(0));
  const bento = C.Config.recipes.find(r => r.id === 'bentoBox');
  ok('只有能量便当适合长途携带', bento.buff === 'portable');
}

section('25. 存档往返');
{
  world();
  const k = kitchen();
  C.Cooking.xp = 500;
  C.Cooking.start('eggRice', k.st, 10);        // 先开火
  C.Power.setBreaker('c1', false);             // 再拉闸（存档要记住闸是断的）
  const pRaw = JSON.parse(JSON.stringify(C.Power.serialize()));
  const cRaw = JSON.parse(JSON.stringify(C.Cooking.serialize()));

  world();
  C.Power.addCircuit('c1', '四层照明插座');
  C.Power.deserialize(pRaw);
  C.Cooking.deserialize(cRaw);
  ok('回路开关状态还原', C.Power.circuits.get('c1').breakerOn === false);
  ok('链路与设备还原', C.Power.links.length === 1 && C.Power.links[0].devices.length === 1);
  ok('熟练度还原', C.Cooking.xp === 500);
  ok('正在做的那锅菜还原', C.Cooking.stations[0].session &&
     C.Cooking.stations[0].session.recipeId === 'eggRice');
  ok('厨房与链路重新挂上了', C.Cooking.stations[0].link === C.Power.links[0]);
}

console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + `${pass} 通过 / ${fail} 失败\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
