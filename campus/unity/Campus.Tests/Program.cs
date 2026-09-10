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

    Section("10. 硬约束：Campus.Core 里零 UnityEngine 引用");
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
