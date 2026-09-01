/*
 * 07-time.js —— 游戏时钟（主文档 3.1）
 * 1 游戏小时 = 85 秒真实。夜间声音系数平滑过渡，不做整点硬切换。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const { M } = C;

  function TimeSystem() {
    const t = C.Config.time;
    this.day = 1;
    this.hour = t.startHour;              // 0–24 浮点
    this.totalGameSeconds = 0;
    this.timeScale = 1;
    this.paused = false;
    this._lastHourInt = Math.floor(this.hour);
  }

  TimeSystem.prototype.update = function (dtReal) {
    if (this.paused) return;
    const t = C.Config.time;
    const dh = (dtReal * this.timeScale) / t.secondsPerGameHour;
    this.hour += dh;
    this.totalGameSeconds += dh * 3600;
    while (this.hour >= 24) {
      this.hour -= 24; this.day++;
      C.EventBus.publish(C.Events.DayPassed, { day: this.day });
    }
    const hi = Math.floor(this.hour);
    if (hi !== this._lastHourInt) {
      this._lastHourInt = hi;
      C.EventBus.publish(C.Events.HourPassed, { day: this.day, hour: hi });
    }
  };

  /** 0.7 ~ 1.0 的当前夜间衰减乘数（声音规格 7.3 / 主文档 3.1） */
  TimeSystem.prototype.getNightFactor = function () {
    const t = C.Config.time;
    const h = this.hour;
    const nf = t.nightFactor;
    // 19:00 → 19:30 由 1.0 平滑降到 0.7
    if (h >= t.nightFadeStartHour && h < t.nightFadeStartHour + t.nightFadeHours) {
      return M.lerp(1.0, nf, M.smoothstep((h - t.nightFadeStartHour) / t.nightFadeHours));
    }
    // 05:30 → 06:00 由 0.7 平滑回到 1.0
    if (h >= t.dawnFadeStartHour && h < t.dawnFadeStartHour + t.dawnFadeHours) {
      return M.lerp(nf, 1.0, M.smoothstep((h - t.dawnFadeStartHour) / t.dawnFadeHours));
    }
    const isNight = (h >= t.nightFadeStartHour + t.nightFadeHours) || (h < t.dawnFadeStartHour);
    return isNight ? nf : 1.0;
  };

  /** 0（全黑）~ 1（正午）的环境亮度，渲染层用 */
  TimeSystem.prototype.getDaylight = function () {
    const h = this.hour;
    if (h >= 7 && h <= 18) return 1.0;
    if (h > 18 && h < 20) return M.lerp(1.0, 0.0, (h - 18) / 2);
    if (h > 5 && h < 7) return M.lerp(0.0, 1.0, (h - 5) / 2);
    return 0.0;
  };

  TimeSystem.prototype.isNight = function () { return this.getDaylight() < 0.35; };

  TimeSystem.prototype.format = function () {
    const hh = Math.floor(this.hour);
    const mm = Math.floor((this.hour - hh) * 60);
    return ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2);
  };

  C.TimeSystem = TimeSystem;
})(typeof globalThis !== 'undefined' ? globalThis : this);
