using System;

namespace Campus {
  /// <summary>听觉组件。**阈值与精度都不写死，每次使用前向修正管线查询。**</summary>
  public sealed class HearingComponent : IListener {
    public int OwnerId;
    public double BaseThreshold;
    public double BaseLocalization = 1.0;
    public bool ActiveFlag = true;
    public V3 Pos;
    public int Node = -1;
    public int SelfId = -1;
    /// <summary>闻不闻得到味。**只有丧尸闻得到** —— 玩家不是靠鼻子找饭吃的。</summary>
    public bool Smells;
    public SoundSystem Sound;
    public Action<Heard> OnHeard;

    public bool Active => ActiveFlag;
    public int SelfEmitterId => SelfId;
    public V3 Position => Pos;
    public int NodeId => Node;

    public HearingComponent(int ownerId, double baseThreshold) {
      OwnerId = ownerId; BaseThreshold = baseThreshold; SelfId = ownerId;
    }

    public double FinalThreshold() {
      double t = ModifierPipeline.Query("hearing.threshold", BaseThreshold, OwnerId);
      /* 气味的数据挂在声图的节点上，这里**只读不写** —— 听觉层不认识烹饪层。
         闻得到味的（丧尸）在有气味的节点里阈值更低，更容易被惊动。 */
      if (Smells && Sound?.Graph != null && Node >= 0) t -= Sound.Graph.OdorDrop(Node);
      return Math.Max(Config.Hearing.MinThreshold, t);
    }

    /// <summary>对某个响度的可听半径（米）。UI 与调试用，**规则本身不依赖它**。</summary>
    public double AudibleRange(double loudness, double k = 0) =>
      Math.Max(0, (loudness - FinalThreshold()) / (k > 0 ? k : Config.Sound.KIndoor));

    public double FinalLocalization() =>
      M.Clamp(ModifierPipeline.Query("hearing.localization", BaseLocalization, OwnerId), 0, 1);

    public void Deliver(SoundEvent evt, Heard r) {
      double threshold = FinalThreshold();
      double margin = r.Arrival - threshold;
      if (margin <= 0) return;                 // margin ≤ 0：完全无感，直接丢弃
      r.Margin = margin;
      r.Evt = evt;
      OnHeard?.Invoke(r);
    }
  }

  /// <summary>余量 → 反应速度与定位精度。**连续变化，不分档** ——
  /// 近处的丧尸几乎立刻扑向准确位置，远处的迟疑几秒后走向模糊方位。
  /// 没有隐藏随机数，玩家可以在脑内推演（支柱三）。</summary>
  public static class Reaction {
    public static double Delay(double margin) =>
      M.Clamp(Config.ZombieReaction.DelayBase - margin * Config.ZombieReaction.DelayPerMargin,
              Config.ZombieReaction.DelayMin, Config.ZombieReaction.DelayMax);

    public static double LocalizationError(double margin) =>
      M.Clamp(Config.ZombieReaction.ErrorBase - margin * Config.ZombieReaction.ErrorPerMargin,
              Config.ZombieReaction.ErrorMin, Config.ZombieReaction.ErrorMax);

    /// <summary>声纹的距离模糊分级 —— **不给精确米数**。</summary>
    public static string DistanceBand(double margin) {
      if (margin >= Config.Hearing.DistanceBands.Near) return "很近";
      if (margin >= Config.Hearing.DistanceBands.Mid) return "中等";
      return "很远";
    }
  }
}
