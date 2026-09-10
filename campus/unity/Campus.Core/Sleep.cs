using System.Collections.Generic;

namespace Campus {
  /// <summary>睡眠判定的结果。**逐条给出原因，UI 直接照着显示** ——
  /// 玩家永远不用猜「为什么睡不了」。</summary>
  public sealed class SleepCheck {
    public bool Ok;
    public readonly List<string> Reasons = new List<string>();
    public SoundNode Node;
  }

  /// <summary>睡眠与安全睡点。第 2 层：**只认游戏小时和声图**，不认帧。
  ///
  /// 安全睡点三个条件缺一不可：
  /// <code>
  /// 1. 所在房间的所有 Portal 都是 Closed 或 Blocked
  /// 2. 房间内及【相邻节点】没有活着的丧尸
  /// 3. 有床或睡袋
  /// </code>
  /// 睡眠期间时间加速 ×90，饥饿口渴照常累积；
  /// 有 margin &gt; 阈值 的声音到达就惊醒，且**不获得当次睡眠的任何 buff**。</summary>
  public sealed class Sleep {
    public bool Active;
    public double StartHour;
    public double Slept;
    public double Target;
    public bool Interrupted;
    public string WokeReason = "";

    /// <summary>惊醒阈值走管线：「睡得沉」set 35、「浅眠」set 6 就挂在这个 key 上。
    /// **这里不知道世界上存在「特性」这回事。**</summary>
    public static double WakeThreshold(int ownerId) =>
      ModifierPipeline.Query("sleep.interrupt_threshold", Config.Sleep.InterruptMargin, ownerId);

    /// <param name="hasBed">床是几何层的事（`level.solids` 里 tag=bed，见 09-collision 移植）。
    /// 规则层只问「有没有」，不问「在哪」。</param>
    public static SleepCheck Check(SoundGraph g, int nodeId, IEnumerable<int> zombieNodeIds, bool hasBed) {
      var r = new SleepCheck();
      var node = g.GetNode(nodeId);
      if (node == null) { r.Ok = false; r.Reasons.Add("位置异常"); return r; }
      r.Node = node;

      foreach (var pid in node.Portals) {
        if (g.IsPassable(g.GetPortal(pid))) { r.Reasons.Add("还有门窗没关上"); break; }
      }

      var near = new HashSet<int> { node.Id };
      foreach (var pid in node.Portals) near.Add(g.Other(g.GetPortal(pid), node.Id));
      if (zombieNodeIds != null) {
        foreach (var zn in zombieNodeIds) {
          if (near.Contains(zn)) { r.Reasons.Add("这间房或隔壁有丧尸"); break; }
        }
      }

      if (!hasBed) r.Reasons.Add("附近没有床");
      r.Ok = r.Reasons.Count == 0;
      return r;
    }

    public void Begin(TimeSystem time, double hours = 0) {
      Active = true;
      Interrupted = false;
      WokeReason = "";
      StartHour = time.Hour;
      Slept = 0;
      Target = System.Math.Min(Config.Sleep.MaxHours, hours > 0 ? hours : Config.Sleep.DefaultHours);
      time.TimeScale = Config.Sleep.TimeScale;
    }

    public const string Sleeping = "sleeping", Done = "done";

    /// <returns><see cref="Sleeping"/> 或 <see cref="Done"/></returns>
    public string Update(double dtHours, TimeSystem time) {
      if (!Active) return Sleeping;
      Slept += dtHours;
      if (Slept >= Target) { End(time); return Done; }
      return Sleeping;
    }

    public void Interrupt(TimeSystem time, string reason = null) {
      if (!Active) return;
      Interrupted = true;
      WokeReason = reason ?? "被声音惊醒";
      End(time);
    }

    public void End(TimeSystem time) {
      Active = false;
      time.TimeScale = 1;
    }

    /// <summary>精力充沛：22:00 前入睡且连续睡足 6 小时未被中断。
    /// **被吵醒一次就整晚白睡** —— 这是「关门、清干净隔壁」值得做的唯一理由。</summary>
    public bool GrantsRested() {
      if (Interrupted) return false;
      double h = StartHour;
      bool beforeCutoff = (h >= 12 && h < Config.Needs.RestedBeforeHour) || h < 6;
      return beforeCutoff && Slept >= Config.Needs.RestedMinHours;
    }

    public void Reset() { Active = false; Interrupted = false; Slept = 0; }
  }
}
