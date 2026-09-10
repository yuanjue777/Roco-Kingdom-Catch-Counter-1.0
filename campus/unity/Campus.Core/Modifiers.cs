using System;
using System.Collections.Generic;

namespace Campus {
  public enum ModifierMode { Additive, Multiplicative, Override }

  public sealed class Modifier {
    public string Id;
    public int Priority;
    public ModifierMode Mode = ModifierMode.Multiplicative;
    public int OwnerId = -1;                 // -1 = 全局
    public Func<double, int, double> Apply;
  }

  /// <summary>数值修正管线 —— **所有可变数值的唯一出口**。
  /// 硬约束：业务逻辑不读熟练度/负重/buff/特性，只向本管线要最终值。
  /// 执行顺序：全部 Additive → 全部 Multiplicative → Override。</summary>
  public static class ModifierPipeline {
    static readonly Dictionary<string, List<Modifier>> _reg = new Dictionary<string, List<Modifier>>();

    public static Modifier Register(string key, Modifier m) {
      if (!_reg.TryGetValue(key, out var list)) { list = new List<Modifier>(); _reg[key] = list; }
      if (!list.Exists(x => x.Id == m.Id)) {
        list.Add(m);
        list.Sort((a, b) => a.Priority.CompareTo(b.Priority));
      }
      return m;
    }

    public static void Unregister(string key, string id) {
      if (_reg.TryGetValue(key, out var list)) list.RemoveAll(m => m.Id == id);
    }

    public static bool Has(string key, string id) =>
      _reg.TryGetValue(key, out var list) && list.Exists(m => m.Id == id);

    public static double Query(string key, double baseValue, int ownerId = -1) {
      if (!_reg.TryGetValue(key, out var list) || list.Count == 0) return baseValue;
      double v = baseValue;
      foreach (var m in list) if (m.Mode == ModifierMode.Additive && (m.OwnerId == -1 || m.OwnerId == ownerId)) v = m.Apply(v, ownerId);
      foreach (var m in list) if (m.Mode == ModifierMode.Multiplicative && (m.OwnerId == -1 || m.OwnerId == ownerId)) v = m.Apply(v, ownerId);
      foreach (var m in list) if (m.Mode == ModifierMode.Override && (m.OwnerId == -1 || m.OwnerId == ownerId)) v = m.Apply(v, ownerId);
      return v;
    }

    public static void Clear() => _reg.Clear();
    public static List<string> Inspect(string key) {
      var outp = new List<string>();
      if (_reg.TryGetValue(key, out var list)) foreach (var m in list) outp.Add(m.Id);
      return outp;
    }

    // 常用简写
    public static Modifier Mul(string key, string id, double f, int ownerId = -1, int prio = 0) =>
      Register(key, new Modifier { Id = id, Priority = prio, Mode = ModifierMode.Multiplicative, OwnerId = ownerId, Apply = (v, o) => v * f });
    public static Modifier Add(string key, string id, double d, int ownerId = -1, int prio = 0) =>
      Register(key, new Modifier { Id = id, Priority = prio, Mode = ModifierMode.Additive, OwnerId = ownerId, Apply = (v, o) => v + d });
    public static Modifier Set(string key, string id, double val, int ownerId = -1, int prio = 0) =>
      Register(key, new Modifier { Id = id, Priority = prio, Mode = ModifierMode.Override, OwnerId = ownerId, Apply = (v, o) => val });
  }
}
