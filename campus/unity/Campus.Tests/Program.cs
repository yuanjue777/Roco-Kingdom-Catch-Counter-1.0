using System;
using System.Collections.Generic;
using System.IO;
using Campus;

/*
 * C# 移植的对拍测试。跑法：dotnet run --project Campus.Tests
 *
 * **它不重写断言，它对答案。**
 * 把 JS 那 800 多条断言在 C# 里重写一遍，只能证明「C# 符合我对规格的理解」；
 * 而对拍证明的是「C# 和已经跑通 800 条测试的 JS 算出同一个数」——
 * 后者才是「系统不变」这句话的意思。
 *
 * 标准答案由 tools/export-goldens.js 从 JS 引擎导出。
 * **改了 00-config.js 之后要重新导一次**，两边才会一起变。
 *
 * 输出不带颜色码：这个程序要在 Unity 控制台、CI 日志里都能读。
 */
static class Program {
  static int _pass, _fail;
  static void Ok(string name, bool cond, string extra = null) {
    if (cond) { _pass++; Console.WriteLine("  [ok] " + name); }
    else { _fail++; Console.WriteLine("  [XX] " + name + (extra != null ? "  -> " + extra : "")); }
  }
  static void Section(string t) => Console.WriteLine("\n== " + t);
  static bool Near(double a, double b, double eps = 1e-9) => Math.Abs(a - b) <= eps;

  static int Main() {
    var path = Path.Combine(AppContext.BaseDirectory, "goldens.json");
    if (!File.Exists(path)) {
      Console.WriteLine("找不到 goldens.json —— 先跑 node tools/export-goldens.js");
      return 1;
    }
    var g = Json.Parse(File.ReadAllText(path));

    Section("0. 配置是从 00-config.js 生成的，不是手抄的");
    Ok("室内 k = " + Config.Sound.KIndoor, Config.Sound.KIndoor == 2.0);
    Ok("室外 k = " + Config.Sound.KOutdoor, Config.Sound.KOutdoor == 1.2);
    Ok("丧尸阈值 " + Config.Hearing.Zombie + " / 玩家 " + Config.Hearing.Player,
       Config.Hearing.Zombie == 10 && Config.Hearing.Player == 8);
    Ok("关着的木门衰减 " + Config.PortalAttenuation.WoodDoor.Closed,
       Config.PortalAttenuation.WoodDoor.Closed == 25);
    Ok("门洞没有 Closed 这个状态（值是 null，回退到 Open）",
       Config.PortalAttenuationTable["Doorway"]["Closed"] == null);
    Ok("Closed 与 Blocked 都不允许通行",
       !Config.PortalPassableTable["Closed"] && !Config.PortalPassableTable["Blocked"]);
    Ok("响度表 " + Config.LoudnessTable.Count + " 项都是非负数",
       Config.LoudnessTable.Count > 20 && AllNonNegative(Config.LoudnessTable));

    Section("1. 确定性随机：同一个种子必须逐位一致");
    /* 地图、物资、丧尸布置全靠它可复现。差一位，C# 版就是另一张地图。 */
    var rng = new Rng(20260905);
    int rngBad = 0;
    for (int i = 0; i < g["rngSeq"].Count; i++) {
      double mine = rng.Next(), theirs = g["rngSeq"][i].AsDouble();
      if (!Near(mine, theirs, 0)) rngBad++;
    }
    Ok("xorshift32 前 " + g["rngSeq"].Count + " 个数与 JS 完全相同（逐位）",
       rngBad == 0, rngBad + " 个不同");

    Section("2. 夜间系数曲线（过渡段是 smoothstep，最容易移植错）");
    var t = new TimeSystem();
    int nfBad = 0; double nfWorst = 0;
    foreach (var pt in g["nightCurve"].Items) {
      t.Hour = pt["h"].AsDouble();
      double d = Math.Abs(t.NightFactor - pt["nf"].AsDouble());
      if (d > 1e-12) { nfBad++; nfWorst = Math.Max(nfWorst, d); }
    }
    Ok("24 小时 " + g["nightCurve"].Count + " 个采样点全部一致", nfBad == 0,
       nfBad + " 个不同，最大差 " + nfWorst.ToString("E2"));
    t.Hour = 12; Ok("白天 = 1.0", t.NightFactor == 1.0);
    t.Hour = 23; Ok("夜间 = " + Config.Time.NightFactor, t.NightFactor == Config.Time.NightFactor);
    t.Hour = 19.25;
    Ok("19:15 在过渡中间（严格介于两者之间）",
       t.NightFactor < 1.0 && t.NightFactor > Config.Time.NightFactor, t.NightFactor.ToString("0.0000"));

    Section("3. 时钟：TotalGameSeconds 从 0 开始，不是 Hour x 3600");
    var t2 = new TimeSystem();
    Ok("开局 TotalGameSeconds = 0", t2.TotalGameSeconds == 0);
    double dh = t2.Advance(Config.Time.SecondsPerGameHour);
    Ok("推进 85 真实秒 = 1 游戏小时", Near(dh, 1.0, 1e-12), dh.ToString("0.000000"));
    Ok("小时跟着走", Near(t2.Hour, Config.Time.StartHour + 1, 1e-12));

    Section("4. 修正管线：Additive -> Multiplicative -> Override");
    ModifierPipeline.Clear();
    ModifierPipeline.Mul("t.x", "m", 2);
    ModifierPipeline.Add("t.x", "a", 10);
    Ok("先加后乘：(5+10)x2 = 30", ModifierPipeline.Query("t.x", 5) == 30,
       ModifierPipeline.Query("t.x", 5).ToString());
    ModifierPipeline.Set("t.x", "o", 7);
    Ok("Override 最后生效 = 7", ModifierPipeline.Query("t.x", 5) == 7);
    ModifierPipeline.Clear();
    ModifierPipeline.Add("t.y", "own", 100, ownerId: 3);
    Ok("ownerId 过滤：别人的修正不生效", ModifierPipeline.Query("t.y", 1, 9) == 1);
    Ok("ownerId 过滤：自己的生效", ModifierPipeline.Query("t.y", 1, 3) == 101);
    ModifierPipeline.Clear();

    Section("5. 建图：节点与 Portal 与 JS 完全一致");
    var graph = BuildGraph(g["graph"]);
    Ok(graph.Nodes.Count + " 个节点", graph.Nodes.Count == g["graph"]["nodes"].Count);
    Ok(graph.Portals.Count + " 个 Portal", graph.Portals.Count == g["graph"]["portals"].Count);

    Section("6. 传播对拍：C# 与 JS 必须算出同一个数");
    var sound = new SoundSystem();
    var clock = new TimeSystem();
    sound.Init(graph, clock);
    int bad = 0; double worst = 0; string worstCase = "";
    foreach (var c in g["cases"].Items) {
      var door = graph.GetPortal((int)c["doorPortalId"].AsDouble());
      door.State = c["portalState"].AsString();
      clock.Hour = c["hour"].AsDouble();
      var evt = new SoundEvent {
        WorldPosition = SrcOf(graph, (int)c["srcNode"].AsDouble()),
        NodeId = (int)c["srcNode"].AsDouble(),
        Loudness = c["loud"].AsDouble()
      };
      var res = sound.Propagate(evt);
      var pos = new V3(c["listenerPos"][0].AsDouble(), c["listenerPos"][1].AsDouble(),
                       c["listenerPos"][2].AsDouble());
      var r = sound.ResolveAt(res, pos, (int)c["listenerNode"].AsDouble());
      double mine = r != null ? r.Arrival : 0;
      double d = Math.Abs(mine - c["arrival"].AsDouble());
      if (d > 1e-9) { bad++; if (d > worst) { worst = d; worstCase = c["label"].AsString(); } }
    }
    Ok(g["cases"].Count + " 个用例的到达响度全部一致（误差 < 1e-9）", bad == 0,
       bad + " 个不同，最差 " + worstCase + " 差 " + worst.ToString("E3"));

    Section("7. 传播快照：整张图上每个节点的到达值");
    {
      var door = graph.GetPortal(FirstWoodDoor(graph));
      door.State = PortalState.Open;
      clock.Hour = 12;
      int srcNode = (int)g["cases"][0]["srcNode"].AsDouble();
      var evt = new SoundEvent { WorldPosition = SrcOf(graph, srcNode), NodeId = srcNode, Loudness = 90 };
      var res = sound.Propagate(evt);
      Ok("传到 " + res.Count + " 个节点", res.Count == g["snapshot"].Count,
         res.Count + " vs " + g["snapshot"].Count);
      int sbad = 0; double sworst = 0;
      foreach (var s in g["snapshot"].Items) {
        int id = (int)s["nodeId"].AsDouble();
        if (!res.TryGetValue(id, out var rec)) { sbad++; continue; }
        double d = Math.Abs(rec.Arrival - s["arrival"].AsDouble());
        double dp = Math.Abs(rec.PathLen - s["pathLen"].AsDouble());
        if (d > 1e-9 || dp > 1e-9) { sbad++; sworst = Math.Max(sworst, Math.Max(d, dp)); }
        if (rec.EntryPortalId != (int)s["entryPortalId"].AsDouble()) sbad++;
      }
      /* 入口 Portal 也要一致 —— **它决定声纹指向哪个方向**。
         只对到达响度的话，走了另一条等价代价的路径也算「通过」，
         但玩家在画面上看到的方向是错的。 */
      Ok("每个节点的到达响度、路径长度、入口 Portal 全部一致", sbad == 0,
         sbad + " 处不同，最大差 " + sworst.ToString("E3"));
    }

    Section("8. 听觉：阈值、可听半径、反应曲线");
    {
      var hc = new HearingComponent(1, Config.Hearing.Zombie); hc.Sound = sound;
      Ok("丧尸阈值 " + hc.FinalThreshold(), hc.FinalThreshold() == 10);
      Ok("可听半径 = (响度 - 阈值) / k：走路 20 -> 5m",
         Near(hc.AudibleRange(Config.Loudness.Walk), 5, 1e-12),
         hc.AudibleRange(Config.Loudness.Walk).ToString());
      Ok("跑步 45 -> 17.5m", Near(hc.AudibleRange(Config.Loudness.Run), 17.5, 1e-12));
      ModifierPipeline.Clear();
      ModifierPipeline.Add("hearing.threshold", "breath", -Config.Hearing.HoldBreathBonus, ownerId: 1);
      Ok("屏息 -" + Config.Hearing.HoldBreathBonus + " -> 阈值 4", hc.FinalThreshold() == 4);
      ModifierPipeline.Clear();
      var weak = new HearingComponent(2, 1); weak.Sound = sound;
      Ok("阈值有下限，不会被压到 0 以下", weak.FinalThreshold() >= Config.Hearing.MinThreshold);

      Ok("margin 0 -> 反应 3 秒（最慢）", Near(Reaction.Delay(0), Config.ZombieReaction.DelayMax, 1e-12));
      Ok("margin 很大 -> 反应触底 0.1 秒", Near(Reaction.Delay(999), Config.ZombieReaction.DelayMin, 1e-12));
      Ok("margin 0 -> 定位误差 12 米", Near(Reaction.LocalizationError(0), Config.ZombieReaction.ErrorBase, 1e-12));
      Ok("margin 很大 -> 误差归零", Reaction.LocalizationError(999) == 0);
      Ok("距离分级：很近 / 中等 / 很远",
         Reaction.DistanceBand(40) == "很近" && Reaction.DistanceBand(20) == "中等"
         && Reaction.DistanceBand(5) == "很远");
    }

    Section("9. 气味挂在图上（第 1 层），听觉只读不写");
    {
      var hc = new HearingComponent(3, Config.Hearing.Zombie);
      hc.Sound = sound; hc.Smells = true; hc.Node = 0;
      Ok("没有气味时阈值不变", hc.FinalThreshold() == Config.Hearing.Zombie);
      graph.AddOdor(new[] { 0 }, 6, 100);
      Ok("有气味的节点里，丧尸阈值降低 6", hc.FinalThreshold() == Config.Hearing.Zombie - 6);
      graph.AddOdor(new[] { 0 }, 4, 100);
      /* **多份气味取最大，不叠加** —— 免得做两顿饭就把阈值打到 0。 */
      Ok("两份气味取最大，不叠加", hc.FinalThreshold() == Config.Hearing.Zombie - 6);
      var human = new HearingComponent(4, Config.Hearing.Player);
      human.Sound = sound; human.Smells = false; human.Node = 0;
      Ok("玩家闻不到味 —— 阈值不受影响", human.FinalThreshold() == Config.Hearing.Player);
      graph.ExpireOdors(200);
      Ok("到期后清掉", hc.FinalThreshold() == Config.Hearing.Zombie);
    }

    Section("10. 需求：逐步对拍（顺序错了才是移植真正会踩的坑）");
    {
      /* 对拍的不是「跑 8 小时后口渴是多少」，而是**每一步之后的全部字段**。
         腹泻倍率在扣 diarrheaHours 之前还是之后、精力充沛先乘再扣还是先扣再乘、
         stamina.max 是先被困乏挤占再过管线还是反过来 ——
         这些顺序问题算出来的差别很小，小到肉眼看不出来，但会一路漂到别的系统里。 */
      ModifierPipeline.Clear();
      const int owner = 7;
      int nbad = 0, steps = 0, ti = 0; string firstBad = null;
      foreach (var trace in g["needsTraces"].Items) {
        ti++;
        ModifierPipeline.Clear();
        var nrng = new Rng(ti == 1 ? 4242u : 99u);
        var n = new Needs(owner);
        int si = 0;
        foreach (var step in trace.Items) {
          var op = step["op"];
          switch (op[0].AsString()) {
            case "update":        n.Update(op[1].AsDouble(), op[2].AsBool()); break;
            case "consume":       n.Consume(op[1].AsString(), nrng); break;
            case "damage":        n.Damage(op[1].AsDouble(), op[2].AsString()); break;
            case "heal":          n.Heal(op[1].AsDouble()); break;
            case "grantRested":   n.GrantRested(); break;
            case "staminaMod":    ModifierPipeline.Add("stamina.max", "iron", 40, owner); break;
            case "staminaMulMod": ModifierPipeline.Mul("stamina.max", "orderPin", 1.5, owner); break;
            case "thirstMod":     ModifierPipeline.Mul("need.thirst_rate", "needsWater", 1.3, owner); break;
            case "fatigueMod":    ModifierPipeline.Mul("need.fatigue_rate", "sleepyHead", 1.35, owner); break;
            case "clearMods":     ModifierPipeline.Clear(); break;
          }
          var w = step["state"];
          string why = null;
          if (!Near(n.Hunger, w["hunger"].AsDouble())) why = "hunger";
          else if (!Near(n.Thirst, w["thirst"].AsDouble())) why = "thirst";
          else if (!Near(n.Fatigue, w["fatigue"].AsDouble())) why = "fatigue";
          else if (!Near(n.Health, w["health"].AsDouble())) why = "health";
          else if (!Near(n.HealthMax(), w["healthMax"].AsDouble())) why = "healthMax";
          else if (!Near(n.StaminaMax(), w["staminaMax"].AsDouble())) why = "staminaMax";
          else if (!Near(n.DiarrheaHours, w["diarrheaHours"].AsDouble())) why = "diarrheaHours";
          else if (!Near(n.RestedHours, w["restedHours"].AsDouble())) why = "restedHours";
          else if (n.Dead != w["dead"].AsBool()) why = "dead";
          else if (n.Cause != w["cause"].AsString("")) why = "cause";
          si++; steps++;
          if (why != null && firstBad == null)
            firstBad = "第 " + ti + " 条轨迹第 " + si + " 步 " + op[0].AsString() + " 的 " + why;
          if (why != null) nbad++;
        }
      }
      Ok(steps + " 步操作后的 10 个字段全部一致（误差 < 1e-9）", nbad == 0, firstBad);
      ModifierPipeline.Clear();

      // 单独点名几条最容易被移植丢掉的规则
      var m = new Needs(1);
      Ok("开局口渴 = " + Config.Needs.StartThirst + "，不是 0", m.Thirst == Config.Needs.StartThirst);
      Ok("开局可用生命上限已经被口渴挤掉一块", m.HealthMax() == Config.Needs.BarLength - Config.Needs.StartThirst);
      m.Damage(50);
      m.Consume("water");
      Ok("喝水解除挤占，但**不回血**", m.Health == 50 && m.HealthMax() > 50);
      var dead = new Needs(2);
      dead.Update(200, false);
      Ok("一路挤占到 0 = 死，死因分得清渴死/饿死", dead.Dead && dead.Cause == "渴死", dead.Cause);
    }

    Section("11. 睡眠状态机：中断一次，整晚白睡");
    {
      var t3 = new TimeSystem();
      var sl = new Sleep();
      int nbad = 0, steps = 0; string firstBad = null;
      foreach (var step in g["sleepTrace"].Items) {
        var op = step["op"];
        string ret = "";
        switch (op[0].AsString()) {
          case "begin":     t3.Hour = op[1].AsDouble(); sl.Begin(t3, op[2].AsDouble()); break;
          case "update":    ret = sl.Update(op[1].AsDouble(), t3); break;
          case "interrupt": sl.Interrupt(t3, op[1].AsString()); break;
          case "reset":     sl.Reset(); break;
        }
        var w = step["state"];
        string why = null;
        if (ret != step["ret"].AsString("")) why = "返回值";
        else if (sl.Active != w["active"].AsBool()) why = "active";
        else if (!Near(sl.Slept, w["slept"].AsDouble())) why = "slept";
        else if (!Near(sl.Target, w["target"].AsDouble())) why = "target";
        else if (!Near(sl.StartHour, w["startHour"].AsDouble())) why = "startHour";
        else if (sl.Interrupted != w["interrupted"].AsBool()) why = "interrupted";
        else if (sl.WokeReason != w["wokeReason"].AsString("")) why = "wokeReason";
        else if (sl.GrantsRested() != w["grantsRested"].AsBool()) why = "grantsRested";
        else if (!Near(t3.TimeScale, w["timeScale"].AsDouble())) why = "timeScale";
        steps++;
        if (why != null && firstBad == null) firstBad = "第 " + steps + " 步 " + op[0].AsString() + " 的 " + why;
        if (why != null) nbad++;
      }
      Ok(steps + " 步睡眠操作全部一致（含 timeScale 与 grantsRested）", nbad == 0, firstBad);

      // 惊醒阈值走管线：「睡得沉」set 35、「浅眠」set 6
      ModifierPipeline.Clear();
      int wbad = 0;
      foreach (var w in g["wakeThresholds"].Items) {
        string id = w["id"].AsString();
        if (id == "deepSleeper") ModifierPipeline.Set("sleep.interrupt_threshold", id, 35, 0);
        if (id == "lightSleeper") {
          ModifierPipeline.Unregister("sleep.interrupt_threshold", "deepSleeper");
          ModifierPipeline.Set("sleep.interrupt_threshold", id, 6, 0);
        }
        if (!Near(Sleep.WakeThreshold(0), w["v"].AsDouble())) wbad++;
      }
      Ok("惊醒阈值 15 / 睡得沉 35 / 浅眠 6，全部来自管线", wbad == 0);
      ModifierPipeline.Clear();
    }

    Section("12. 安全睡点：门 / 隔壁丧尸 / 床，三条各自独立");
    {
      /* 逐条给出原因，**UI 直接照着显示** —— 玩家不用猜为什么睡不了。
         所以对拍的不只是 ok，还有那几句话本身和它们的顺序。 */
      var g3 = BuildGraph(g["graph"]);
      int nbad = 0; string firstBad = null;
      foreach (var c in g["sleepChecks"].Items) {
        int nodeId = (int)c["nodeId"].AsDouble();
        string st = c["portalState"].AsString();
        foreach (var pid in g3.GetNode(nodeId).Portals) g3.GetPortal(pid).State = st;
        var zs = new List<int>();
        foreach (var z in c["zombieNodes"].Items) zs.Add((int)z.AsDouble());
        var r = Sleep.Check(g3, nodeId, zs, c["hasBed"].AsBool());
        string why = null;
        if (r.Ok != c["ok"].AsBool()) why = "ok";
        else if (r.Reasons.Count != c["reasons"].Count) why = "原因条数";
        else for (int i = 0; i < r.Reasons.Count; i++)
          if (r.Reasons[i] != c["reasons"][i].AsString()) { why = "第 " + (i + 1) + " 条原因"; break; }
        if (why != null && firstBad == null) firstBad = c["label"].AsString() + " 的 " + why;
        if (why != null) nbad++;
      }
      Ok(g["sleepChecks"].Count + " 种组合的判定与原因文字全部一致", nbad == 0, firstBad);
    }

    Section("13. 自检场景：CampusSelfTest.cs 在 Unity 里会打出的数");
    {
      /* 对面在编辑器里按下播放，第一眼看到的就是这几个数。
         **如果它们是错的，人家会认为整个移植是坏的。**
         这里和 UnityGlue 里那个 MonoBehaviour 搭的是同一个场景、同一个顺序。 */
      var sg = new SoundGraph();
      var room = sg.AddNode("402", AABB.Make(0, 0, 0, 4, 3, 6));
      var corr = sg.AddNode("4F走廊", AABB.Make(4, 0, 0, 6, 3, 20), false, 0, 4, "corridor");
      var door = sg.AddPortal(room.Id, corr.Id, new V3(4, 0, 3), PortalType.WoodDoor, PortalState.Closed);
      var clk = new TimeSystem();
      var ss = new SoundSystem();
      ss.Init(sg, clk, (a, b) => true);
      Heard last = null;
      var ears = new HearingComponent(1, Config.Hearing.Zombie) {
        Sound = ss, Node = corr.Id, Pos = new V3(5, 0, 3), OnHeard = h => last = h
      };
      ss.AddListener(ears);
      var w = g["selfTest"];
      Ok("可听半径 " + ears.AudibleRange(Config.Loudness.Run) + " m",
         Near(ears.AudibleRange(Config.Loudness.Run), w["audibleRange"].AsDouble()));

      Func<Json, string, bool> shout = (want, label) => {
        last = null;
        ss.Emit(new V3(2, 0, 3), Config.Loudness.Run, SoundCategory.Footstep, 99, 0, "跑步");
        return last != null && Near(last.Arrival, want["arrival"].AsDouble())
               && Near(last.Margin, want["margin"].AsDouble())
               && Near(last.PathLen, want["pathLen"].AsDouble());
      };
      Ok("关着木门：到达 " + w["closed"]["arrival"].AsDouble() + "，余量 " + w["closed"]["margin"].AsDouble(),
         shout(w["closed"], "closed"));
      sg.SetPortalState(door, PortalState.Open);
      Ok("门开着：到达 " + w["open"]["arrival"].AsDouble() + "，余量 " + w["open"]["margin"].AsDouble(),
         shout(w["open"], "open"));

      var n3 = new Needs(1);
      Ok("开局口渴 " + n3.Thirst + "，生命上限 " + n3.HealthMax(),
         Near(n3.Thirst, w["startThirst"].AsDouble()) && Near(n3.HealthMax(), w["startHealthMax"].AsDouble()));
      n3.Update(8, false);
      var a8 = w["after8h"];
      Ok("醒着过 8 小时的四个数与 JS 一致",
         Near(n3.Thirst, a8["thirst"].AsDouble()) && Near(n3.Hunger, a8["hunger"].AsDouble())
         && Near(n3.Fatigue, a8["fatigue"].AsDouble()) && Near(n3.HealthMax(), a8["healthMax"].AsDouble()));
    }

    Section("14. 硬约束：Campus.Core 里零 UnityEngine 引用");
    {
      var asm = typeof(SoundSystem).Assembly;
      bool clean = true; string offender = null;
      foreach (var an in asm.GetReferencedAssemblies())
        if (an.Name.StartsWith("UnityEngine") || an.Name.StartsWith("UnityEditor")) {
          clean = false; offender = an.Name;
        }
      /* 第 1-3 层必须能脱离渲染引擎运行 —— 这是改数值不引入回归的唯一保证。
         这条断言让「顺手 using UnityEngine 一下」立刻变红。 */
      Ok("规则层没有引用任何 Unity 程序集", clean, offender);
    }

    Console.WriteLine("\n" + _pass + " 通过 / " + _fail + " 失败\n");
    return _fail == 0 ? 0 : 1;
  }

  static bool AllNonNegative(Dictionary<string, double> d) {
    foreach (var kv in d) if (kv.Value < 0) return false;
    return true;
  }

  static V3 SrcOf(SoundGraph g, int nodeId) => AABB.Center(g.GetNode(nodeId).Bounds);

  static int FirstWoodDoor(SoundGraph g) {
    foreach (var p in g.Portals) if (p.Type == PortalType.WoodDoor) return p.Id;
    return 0;
  }

  static SoundGraph BuildGraph(Json j) {
    var g = new SoundGraph();
    foreach (var n in j["nodes"].Items) {
      var b = n["bounds"];
      g.AddNode(n["name"].AsString(),
        AABB.Make(b[0].AsDouble(), b[1].AsDouble(), b[2].AsDouble(),
                  b[3].AsDouble(), b[4].AsDouble(), b[5].AsDouble()),
        n["isOutdoor"].AsBool(), (int)n["buildingId"].AsDouble(),
        (int)n["floor"].AsDouble(), n["kind"].AsString());
    }
    foreach (var p in j["portals"].Items) {
      var q = p["pos"];
      g.AddPortal((int)p["a"].AsDouble(), (int)p["b"].AsDouble(),
        new V3(q[0].AsDouble(), q[1].AsDouble(), q[2].AsDouble()),
        p["type"].AsString(), p["state"].AsString());
    }
    return g;
  }
}
