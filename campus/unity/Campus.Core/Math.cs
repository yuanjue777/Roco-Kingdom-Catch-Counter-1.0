using System;

namespace Campus {
  /// <summary>三维向量。规则层只用这个普通结构体，不碰 UnityEngine.Vector3 ——
  /// 这样第 1–3 层可以脱离渲染在命令行里跑测试。</summary>
  public struct V3 {
    public double x, y, z;
    public V3(double x, double y, double z) { this.x = x; this.y = y; this.z = z; }
    public override string ToString() => $"({x:0.##},{y:0.##},{z:0.##})";
  }

  public static class V {
    public static V3 Make(double x = 0, double y = 0, double z = 0) => new V3(x, y, z);
    public static V3 Add(V3 a, V3 b) => new V3(a.x + b.x, a.y + b.y, a.z + b.z);
    public static V3 Sub(V3 a, V3 b) => new V3(a.x - b.x, a.y - b.y, a.z - b.z);
    public static V3 Scale(V3 a, double s) => new V3(a.x * s, a.y * s, a.z * s);
    public static double Len(V3 a) => Math.Sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    public static double Dist(V3 a, V3 b) {
      double dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      return Math.Sqrt(dx * dx + dy * dy + dz * dz);
    }
    public static double DistXZ(V3 a, V3 b) {
      double dx = a.x - b.x, dz = a.z - b.z;
      return Math.Sqrt(dx * dx + dz * dz);
    }
    public static V3 Norm(V3 a) { var l = Len(a); if (l == 0) l = 1; return new V3(a.x / l, a.y / l, a.z / l); }
    public static double Dot(V3 a, V3 b) => a.x * b.x + a.y * b.y + a.z * b.z;
    public static V3 Lerp(V3 a, V3 b, double t) =>
      new V3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }

  public static class M {
    public static double Clamp(double v, double lo, double hi) => v < lo ? lo : (v > hi ? hi : v);
    public static double Lerp(double a, double b, double t) => a + (b - a) * t;
    public static double Smoothstep(double t) { t = Clamp(t, 0, 1); return t * t * (3 - 2 * t); }
    public const double Deg2Rad = Math.PI / 180.0;
    public static double WrapAngle(double a) {
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      return a;
    }
  }

  /// <summary>确定性随机（xorshift32）。
  /// **支柱三：玩家应该能在脑内推演 —— 随机必须可复现。**
  /// 这里的实现必须和 JS 版逐位一致，否则同一个种子生成的地图/物资会不一样。</summary>
  public sealed class Rng {
    uint _s;
    public Rng(uint seed) { _s = seed == 0 ? 1u : seed; }
    public double Next() {
      uint x = _s;
      x ^= x << 13;
      /* **中间这一步必须是【有符号】右移。**
         JS 里 `x ^= x >> 17` 的 `>>` 会先把值转成 int32 再算术右移（高位补符号位），
         而 C# 的 `uint >>` 是逻辑右移（高位补 0）。两者在最高位为 1 时结果不同。

         `[实测]` 直接写成 `x ^= x >> 17` 的话，同一个种子在 C# 和 JS 里
         **从第一个数就分岔** —— 而地图、物资、丧尸布置全靠这个种子可复现，
         后果是 Unity 版和网页版根本不是同一所学校，且没有任何东西会报错。
         左移和异或对有无符号是一样的，所以只有这一行需要特殊处理。 */
      int xi = unchecked((int)x);
      x = unchecked((uint)(xi ^ (xi >> 17)));
      x ^= x << 5;
      _s = x;
      return x / 4294967296.0;
    }
    public double Range(double lo, double hi) => lo + Next() * (hi - lo);
    public int Int(int lo, int hi) => (int)Math.Floor(Range(lo, hi + 1));
    public T Pick<T>(System.Collections.Generic.IList<T> a) =>
      a[Math.Min(a.Count - 1, (int)Math.Floor(Next() * a.Count))];
    public System.Collections.Generic.IList<T> Shuffle<T>(System.Collections.Generic.IList<T> a) {
      for (int i = a.Count - 1; i > 0; i--) {
        int j = (int)Math.Floor(Next() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }
  }

  public struct Box {
    public V3 min, max;
    public Box(double x0, double y0, double z0, double x1, double y1, double z1) {
      min = new V3(x0, y0, z0); max = new V3(x1, y1, z1);
    }
  }

  public static class AABB {
    public static Box Make(double x0, double y0, double z0, double x1, double y1, double z1) =>
      new Box(x0, y0, z0, x1, y1, z1);
    public static Box FromCenterSize(double cx, double cy, double cz, double sx, double sy, double sz) =>
      new Box(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2);
    public static bool Contains(Box b, V3 p) =>
      p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
    public static bool ContainsXZ(Box b, V3 p) =>
      p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z;
    public static V3 Center(Box b) =>
      new V3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);

    /// <summary>线段与盒子相交（slab 法），视线遮挡判定用。</summary>
    public static bool SegmentIntersects(Box b, V3 p0, V3 p1) {
      double tmin = 0, tmax = 1;
      var d = V.Sub(p1, p0);
      for (int ax = 0; ax < 3; ax++) {
        double da = ax == 0 ? d.x : ax == 1 ? d.y : d.z;
        double pa = ax == 0 ? p0.x : ax == 1 ? p0.y : p0.z;
        double lo = ax == 0 ? b.min.x : ax == 1 ? b.min.y : b.min.z;
        double hi = ax == 0 ? b.max.x : ax == 1 ? b.max.y : b.max.z;
        if (Math.Abs(da) < 1e-8) { if (pa < lo || pa > hi) return false; }
        else {
          double inv = 1 / da, t1 = (lo - pa) * inv, t2 = (hi - pa) * inv;
          if (t1 > t2) { var t = t1; t1 = t2; t2 = t; }
          tmin = Math.Max(tmin, t1);
          tmax = Math.Min(tmax, t2);
          if (tmin > tmax) return false;
        }
      }
      return true;
    }
  }
}
