using System;

namespace Campus {
  /// <summary>生存需求。第 2 层：**只认游戏小时**，不认帧、不认渲染。
  ///
  /// 生命条总长 100 固定，饥饿与口渴各自从右端【挤占】：
  /// <code>
  /// 可用生命上限 = 100 − 饥饿挤占 − 口渴挤占
  /// 进食/饮水立即解除挤占，但【不回血】—— 受过的伤要单独治
  /// 上限降到 0 = 死亡
  /// </code>
  /// 「吃喝不回血」这一条比任何伤害数值都更能让玩家不愿意开打（见 Injury）。</summary>
  public sealed class Needs {
    public int OwnerId;
    public double Hunger;
    public double Thirst;
    public double Fatigue;
    public double Health;
    public double DiarrheaHours;
    public double RestedHours;
    public bool Dead;
    public string Cause = "";

    public Needs(int ownerId) {
      OwnerId = ownerId;
      Hunger = 0;
      /* **开局就有 30 点口渴，不是 0。**
         教学第一条目标是「嗓子干得厉害，先找点喝的」——
         口渴 0 的话这句话是假的，而且那个目标在第 0 秒就自动完成了，
         新手看到的第一件事会是一个自己没做过的「完成」。 */
      Thirst = Config.Needs.StartThirst;
      Fatigue = 0;
      Health = Config.Needs.BarLength;
    }

    public double HealthMax() => Math.Max(0, Config.Needs.BarLength - Hunger - Thirst);

    public double StaminaMax() {
      /* 先算被困乏挤占后的上限，**再**让特性加减 ——
         反过来的话「铁人 +40」会被困乏按比例吃掉一部分，读起来对不上。 */
      double base_ = Math.Max(0, Config.Needs.BarLength - Fatigue);
      return Math.Max(0, ModifierPipeline.Query("stamina.max", base_, OwnerId));
    }

    public bool IsRested() => RestedHours > 0;

    /// <param name="dtHours">经过的游戏小时</param>
    /// <param name="sleeping">是否在睡眠中</param>
    public void Update(double dtHours, bool sleeping) {
      if (Dead || dtHours <= 0) return;
      double L = Config.Needs.BarLength;

      /* 三条速率**全部走管线**。特性（耐渴/大胃口/嗜睡…）就挂在这三个 key 上，
         **这里永远不知道世界上存在「角色」这回事**。 */
      double thirstRate = ModifierPipeline.Query("need.thirst_rate", L / Config.Needs.ThirstFullHours, OwnerId);
      if (DiarrheaHours > 0) {
        thirstRate *= Config.Needs.DiarrheaThirstMul;
        DiarrheaHours = Math.Max(0, DiarrheaHours - dtHours);
      }
      double hungerRate = ModifierPipeline.Query("need.hunger_rate", L / Config.Needs.HungerFullHours, OwnerId);
      Thirst = M.Clamp(Thirst + thirstRate * dtHours, 0, L);
      Hunger = M.Clamp(Hunger + hungerRate * dtHours, 0, L);

      // 困乏：清醒时涨、睡眠时退。精力充沛期间涨得慢
      if (sleeping) {
        Fatigue = M.Clamp(Fatigue - Config.Needs.FatigueSleepPerHour * dtHours, 0, L);
      } else {
        double rate = ModifierPipeline.Query("need.fatigue_rate", Config.Needs.FatigueRatePerHour, OwnerId);
        if (RestedHours > 0) {
          rate *= Config.Needs.RestedFatigueMul;
          RestedHours = Math.Max(0, RestedHours - dtHours);
        }
        Fatigue = M.Clamp(Fatigue + rate * dtHours, 0, L);
      }

      // 挤占增长把当前生命压低 —— **这就是饿死渴死的机制**
      double cap = HealthMax();
      if (Health > cap) Health = cap;
      if (cap <= 0 && !Dead) {
        Dead = true;
        Cause = Thirst >= Hunger ? "渴死" : "饿死";
      }
      EventBus.Publish(Events.NeedChanged, this);
    }

    public void Damage(double amount, string cause = null) {
      Health = Math.Max(0, Health - amount);
      if (Health <= 0 && !Dead) { Dead = true; Cause = cause ?? "失血过多"; }
    }

    /// <summary>治疗只抬当前生命，**抬不过当前上限**。</summary>
    public void Heal(double amount) => Health = Math.Min(HealthMax(), Health + amount);

    /// <summary>吃/喝。<paramref name="rng"/> 可注入以保证可复现（支柱三）。</summary>
    public (bool ok, string msg) Consume(string key, Rng rng = null) {
      var item = Config.All["items"][key];
      if (!item.Exists) return (false, "没有这个东西");
      double L = Config.Needs.BarLength;
      Thirst = M.Clamp(Thirst + item["thirst"].AsDouble(), 0, L);
      Hunger = M.Clamp(Hunger + item["hunger"].AsDouble(), 0, L);
      string msg = item["name"].AsString("");
      double dc = item["diarrheaChance"].AsDouble(0);
      if (dc > 0 && (rng != null ? rng.Next() : new Random().NextDouble()) < dc) {
        DiarrheaHours = Config.Needs.DiarrheaHours;
        msg += "（喝出了腹泻）";
      }
      return (true, msg);
    }

    /// <summary>精力充沛：22:00 前入睡且连睡 ≥6 小时未被中断。
    /// **这个 buff 是玩家规划一天的主要动机** —— 它把「天黑前回家」变成有正反馈的行为。</summary>
    public void GrantRested() => RestedHours = Config.Needs.RestedDurationHours;
  }
}
