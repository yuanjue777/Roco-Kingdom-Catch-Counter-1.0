using System;
using System.Collections.Generic;

namespace Campus {
  public static class PortalType {
    public const string Doorway = "Doorway", WoodDoor = "WoodDoor", SteelDoor = "SteelDoor",
      Window = "Window", Stairwell = "Stairwell", Vent = "Vent", OpenAir = "OpenAir", Curtain = "Curtain";
  }
  public static class PortalState {
    public const string Open = "Open", Closed = "Closed", Broken = "Broken", Blocked = "Blocked";
  }

  public sealed class SoundNode {
    public int Id;
    public string Name;
    public Box Bounds;
    public bool IsOutdoor;
    public int BuildingId;
    public int Floor;
    public string Kind = "room";           // room / corridor / stair / outdoor
    public readonly List<int> Portals = new List<int>();
  }

  public sealed class Portal {
    public int Id;
    public int NodeA, NodeB;
    public V3 Position;
    public string Type;
    public string State = PortalState.Open;
    public object View;                     // 渲染层挂门板用，规则层不关心
  }

  struct Odor { public int NodeId; public double Drop; public double Until; }

  /// <summary>声音连通图。纯数据，**始终全量常驻**，不随场景加载卸载。</summary>
  public sealed class SoundGraph {
    public readonly List<SoundNode> Nodes = new List<SoundNode>();
    public readonly List<Portal> Portals = new List<Portal>();
    readonly Dictionary<int, SoundNode> _byNode = new Dictionary<int, SoundNode>();
    readonly Dictionary<int, Portal> _byPortal = new Dictionary<int, Portal>();
    readonly List<Odor> _odors = new List<Odor>();
    int _nextNode, _nextPortal;

    public SoundNode AddNode(string name, Box bounds, bool isOutdoor = false,
                             int buildingId = 0, int floor = 0, string kind = "room") {
      var n = new SoundNode {
        Id = _nextNode++, Name = name ?? ("node" + _nextNode), Bounds = bounds,
        IsOutdoor = isOutdoor, BuildingId = buildingId, Floor = floor, Kind = kind ?? "room"
      };
      Nodes.Add(n); _byNode[n.Id] = n;
      return n;
    }

    public Portal AddPortal(int nodeA, int nodeB, V3 position, string type, string state = PortalState.Open) {
      var p = new Portal { Id = _nextPortal++, NodeA = nodeA, NodeB = nodeB, Position = position, Type = type, State = state };
      Portals.Add(p); _byPortal[p.Id] = p;
      _byNode[nodeA].Portals.Add(p.Id);
      _byNode[nodeB].Portals.Add(p.Id);
      return p;
    }

    public SoundNode GetNode(int id) => _byNode.TryGetValue(id, out var n) ? n : null;
    public Portal GetPortal(int id) => _byPortal.TryGetValue(id, out var p) ? p : null;
    public int Other(Portal p, int nodeId) => p.NodeA == nodeId ? p.NodeB : p.NodeA;

    /* ── 气味 ────────────────────────────────────────
       气味不做传播模拟，是**挂在节点上的一个临时修正**。
       它是第 1 层的数据：烹饪（第 4 层）往下写，听觉（第 2 层）往下读，两边都不认识对方。
       之所以放这里而不是修正管线：**管线按 ownerId 过滤，而气味按节点生效**，塞不进去。 */
    public void AddOdor(IEnumerable<int> nodeIds, double drop, double untilHours) {
      foreach (var id in nodeIds) _odors.Add(new Odor { NodeId = id, Drop = drop, Until = untilHours });
    }
    /// <summary>该节点当前的阈值降低量。**多份气味取最大，不叠加** —— 免得做两顿饭就把阈值打到 0。</summary>
    public double OdorDrop(int nodeId) {
      double d = 0;
      foreach (var o in _odors) if (o.NodeId == nodeId && o.Drop > d) d = o.Drop;
      return d;
    }
    public void ExpireOdors(double nowHours) => _odors.RemoveAll(o => o.Until <= nowHours);
    public void ClearOdors() => _odors.Clear();

    /* 节点归属判定：**y 上界必须是开区间。**
       楼层节点的 y 范围是 [f·H, (f+1)·H]，相邻两层共用一个平面 —— 用闭区间的话，
       一个正好站在 4 楼地板上(y=9.6)的点会先匹配到 3 楼节点(它的 max.y 也是 9.6)。
       后果很隐蔽：丧尸低吼、石头落地这类在地板高度发出的声音会被算成从楼下发出。
       容差是因为楼层高度是浮点累加出来的（3×3.2 = 9.600000000000001）。 */
    const double NodeYEps = 1e-4;
    static bool ContainsNode(Box b, V3 p) =>
      p.x >= b.min.x && p.x <= b.max.x &&
      p.z >= b.min.z && p.z <= b.max.z &&
      p.y >= b.min.y - NodeYEps && p.y < b.max.y - NodeYEps;

    /// <summary>坐标 → 节点。找不到严格包含的就退化为最近节点，避免站在门框上时查询失败。</summary>
    public SoundNode GetNodeAt(V3 pos, int hintNodeId = -1) {
      if (hintNodeId >= 0 && _byNode.TryGetValue(hintNodeId, out var h) && ContainsNode(h.Bounds, pos)) return h;
      /* **室内优先。** 室外分区是覆盖整条带的大盒子，几何上把楼包在里面 ——
         按插入顺序找的话，站在教学楼三楼会被判成「主校道」。 */
      foreach (var n in Nodes) if (!n.IsOutdoor && ContainsNode(n.Bounds, pos)) return n;
      foreach (var n in Nodes) if (n.IsOutdoor && ContainsNode(n.Bounds, pos)) return n;
      SoundNode best = null; double bestD = double.PositiveInfinity;
      foreach (var n in Nodes) {
        var c = AABB.Center(n.Bounds);
        bool inY = pos.y >= n.Bounds.min.y - 0.5 && pos.y <= n.Bounds.max.y + 0.5;
        double d = V.DistXZ(c, pos) + (inY ? 0 : 100);
        if (d < bestD) { bestD = d; best = n; }
      }
      return best;
    }

    /// <summary>当前状态下的衰减值。状态不适用时回退到 Open 值。</summary>
    public double GetAttenuation(Portal p) {
      if (!Config.PortalAttenuationTable.TryGetValue(p.Type, out var row)) return 0;
      if (row.TryGetValue(p.State, out var v) && v.HasValue) return v.Value;
      return row["Open"] ?? 0;
    }

    public bool IsPassable(Portal p) =>
      Config.PortalPassableTable.TryGetValue(p.State, out var b) && b;

    public void SetPortalState(Portal p, string state) {
      if (p.State == state) return;
      var prev = p.State;
      p.State = state;
      // 状态变化必须通知，让传播缓存失效
      EventBus.Publish(Events.PortalStateChanged, new PortalChanged { PortalId = p.Id, Prev = prev, State = state });
    }
  }

  public sealed class PortalChanged { public int PortalId; public string Prev, State; }
}
