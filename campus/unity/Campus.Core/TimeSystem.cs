using System;

namespace Campus {
  /// <summary>声音系统只需要时间的这两样，所以只依赖这个接口 ——
  /// 测试里可以塞一个固定值的假时钟，不用建整个时间系统。</summary>
  public interface ITimeSource {
    double NightFactor { get; }
    double TotalGameSeconds { get; }
  }

  public sealed class TimeSystem : ITimeSource {
    public int Day = 1;
    public double Hour = Config.Time.StartHour;
    public double TotalGameSeconds { get; private set; }
    public double TimeScale = 1.0;

    public bool Paused;

    /* `TotalGameSeconds` **从 0 开始**，不是 `Hour * 3600` ——
       它是「开局以来过了多久」，不是「今天几点了」。
       这两者在第一天看起来只差一个常数，但存档、气味到期、烹饪阶段全都按它算，
       写错了会在读档之后才暴露出来。JS 版是 0，这里必须一致。 */
    public TimeSystem() { TotalGameSeconds = 0; }

    /// <summary>推进 dt 真实秒，返回经过的**游戏小时**。</summary>
    public double Advance(double dtRealSeconds) {
      if (Paused) return 0;
      double dh = dtRealSeconds * TimeScale / Config.Time.SecondsPerGameHour;
      Hour += dh;
      TotalGameSeconds += dh * 3600.0;
      while (Hour >= 24.0) { Hour -= 24.0; Day++; }
      return dh;
    }

    public bool IsNight() => Hour >= Config.Time.NightStartHour || Hour < Config.Time.DayStartHour;

    /// <summary>夜间声音系数。19:00→19:30 由 1.0 平滑降到 0.7，05:30→06:00 平滑回来。
    /// **不是突变** —— 突变会让玩家在 19:00 整点感到一次莫名其妙的听力跳变。</summary>
    public double NightFactor {
      get {
        double h = Hour, nf = Config.Time.NightFactor;
        if (h >= Config.Time.NightFadeStartHour && h < Config.Time.NightFadeStartHour + Config.Time.NightFadeHours)
          return M.Lerp(1.0, nf, M.Smoothstep((h - Config.Time.NightFadeStartHour) / Config.Time.NightFadeHours));
        if (h >= Config.Time.DawnFadeStartHour && h < Config.Time.DawnFadeStartHour + Config.Time.DawnFadeHours)
          return M.Lerp(nf, 1.0, M.Smoothstep((h - Config.Time.DawnFadeStartHour) / Config.Time.DawnFadeHours));
        bool isNight = (h >= Config.Time.NightFadeStartHour + Config.Time.NightFadeHours) || (h < Config.Time.DawnFadeStartHour);
        return isNight ? nf : 1.0;
      }
    }
  }

  /// <summary>测试用的固定时钟。</summary>
  public sealed class FixedTime : ITimeSource {
    public double NightFactor { get; set; } = 1.0;
    public double TotalGameSeconds { get; set; }
  }
}
