/*
 * 14-hud.js —— HUD（主文档 10.1：屏幕上尽可能少）
 * 常驻：体力条、手中物品、准星。屏息时才出现声纹指示环。时间不常驻，按 X 看表。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const { M } = C;

  const MONO = '"JetBrains Mono", ui-monospace, "PingFang SC", monospace';
  const SANS = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  const ACCENT = '#E4573D', SIGNAL = '#6FD3E8';

  /* 声纹图标：矢量画，不用文字。文字标签在小尺寸下认不出来，也不像游戏 HUD。
     脚步＝脚印，低吼＝声波弧，撞击＝爆点，门＝门板加开合弧。 */
  function drawIcon(ctx, cat, x, y, s, col, a) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(' + col + ',' + a.toFixed(3) + ')';
    ctx.fillStyle = 'rgba(' + col + ',' + a.toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, s * 0.16);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (cat === 'Footstep') {
      // 脚掌 + 三个脚趾
      ctx.beginPath();
      ctx.ellipse(0, s * 0.18, s * 0.30, s * 0.44, 0.18, 0, Math.PI * 2);
      ctx.fill();
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(i * s * 0.26 + s * 0.06, -s * 0.44, s * 0.10, s * 0.13, 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (cat === 'Voice' || cat === 'Ambient') {
      // 声波弧
      const n = cat === 'Voice' ? 3 : 2;
      for (let i = 1; i <= n; i++) {
        ctx.beginPath();
        ctx.arc(-s * 0.45, 0, s * 0.3 * i, -0.85, 0.85);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(-s * 0.45, 0, s * 0.11, 0, Math.PI * 2); ctx.fill();
    } else if (cat === 'Door') {
      ctx.beginPath();
      ctx.rect(-s * 0.5, -s * 0.55, s * 0.55, s * 1.1);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(-s * 0.5, s * 0.55, s * 0.95, -1.05, -0.15); ctx.stroke();
    } else {
      // 爆点
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * s * 0.22, Math.sin(ang) * s * 0.22);
        ctx.lineTo(Math.cos(ang) * s * 0.62, Math.sin(ang) * s * 0.62);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(0, 0, s * 0.13, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // 类别配色：脚步青、撞击黄、低吼红、门灰蓝、环境淡青
  const COLORS = { Footstep: '111,211,232', Impact: '255,212,121', Voice: '228,87,61',
                   Door: '150,175,200', Ambient: '120,200,190', Gunshot: '255,120,90', _: '190,210,230' };

  function Hud(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.showWatch = false; }

  Hud.prototype.draw = function (player, time, dt, camera) {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;

    // 准星
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.stroke();

    // 声纹指示环（只在屏息时显示）
    if (player.holdBreath || C.Config.debug.showSoundprintAlways) this._soundprint(player, camera);

    // 生命条与体力条。触屏时挪到左上角 —— 左下角被虚拟摇杆占了，右下角被动作键占了。
    const touch = C.Touch && C.Touch.enabled;
    const S = C.Config.player.stamina;
    const bw = touch ? 150 : 220, bh = touch ? 9 : 12;
    const bx = touch ? 16 : 28, by = touch ? 26 : H - 46;
    const n = player.needs;
    if (n) {
      /* 生命条：长度固定，饥饿与口渴从右端挤占，剩下的才是可用生命上限。
         深色段就是被吃掉的上限 —— 一眼看得出「我还剩多少余地」。 */
      const hy = by - (touch ? 22 : 26), L = C.Config.needs.barLength;
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bx - 2, hy - 2, bw + 4, bh + 4);
      ctx.fillStyle = '#B8443A'; ctx.fillRect(bx, hy, bw * (n.health / L), bh);
      const hungerW = bw * (n.hunger / L), thirstW = bw * (n.thirst / L);
      ctx.fillStyle = '#7a5a2a'; ctx.fillRect(bx + bw - hungerW - thirstW, hy, hungerW, bh);
      ctx.fillStyle = '#2a5a7a'; ctx.fillRect(bx + bw - thirstW, hy, thirstW, bh);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      ctx.strokeRect(bx - 0.5, hy - 0.5, bw + 1, bh + 1);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '10px ' + MONO; ctx.textAlign = 'left';
      ctx.fillText('HP ' + n.health.toFixed(0) + '  饥' + n.hunger.toFixed(0) + '  渴' + n.thirst.toFixed(0)
        + (n.diarrheaHours > 0 ? '  腹泻' : '') + (n.isRested() ? '  精力充沛' : ''), bx, hy - 5);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    ctx.fillStyle = player.exhausted ? ACCENT : SIGNAL;
    ctx.fillRect(bx, by, bw * (player.stamina / S.max), bh);
    if (player.needs) {   // 困乏从右端挤占体力上限
      const fw = bw * (player.needs.fatigue / C.Config.needs.barLength);
      ctx.fillStyle = '#3a3f52'; ctx.fillRect(bx + bw - fw, by, fw, bh);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '11px ' + MONO;
    ctx.textAlign = 'left';
    ctx.fillText('STAMINA', bx, by - 6);

    // 姿态 / 状态
    const tags = [];
    if (player.holdBreath) tags.push('屏息');
    if (player.posture === 'crouch') tags.push('蹲');
    if (player.wallHug) tags.push('贴墙');
    if (player.lean) tags.push(player.lean < 0 ? '左探头' : '右探头');
    if (player.running) tags.push('奔跑');
    if (player.exhausted) tags.push('力竭');
    if (player.vault) tags.push('翻越中');
    else if (player.airborne) tags.push('腾空');
    if (player.flashlight) tags.push('手电');
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = (touch ? '11.5px ' : '12.5px ') + SANS;
    ctx.fillText(tags.join(' · ') || '站立', bx, by + bh + 15);

    // 手中物品 / 快取
    if (touch) {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(220,227,235,0.85)'; ctx.font = '11px ' + MONO;
      ctx.fillText('石头 ×' + player.stones, bx, by + bh + 30);
    } else {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '12px ' + MONO;
      ctx.fillText('石头 ×' + player.stones, W - 28, H - 28);
      if (player.charge > 0) {
        const cw = 120;
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(W - 28 - cw, H - 22, cw, 6);
        ctx.fillStyle = '#ffd479'; ctx.fillRect(W - 28 - cw, H - 22, cw * player.charge, 6);
      }
    }

    // 蓄力投石时的落点读数：圈只能画出「同一空间内的上界」，确切数字得给出来
    if (player.charge > 0 && player.predictThrow) {
      const pr = player.predictThrow();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd479'; ctx.font = '12px ' + MONO;
      ctx.fillText('蓄力 ' + Math.round(player.charge * 100) + '%', cx, cy + 74);
      ctx.fillStyle = SIGNAL;
      ctx.fillText('落点 ' + (pr.node ? pr.node.name : '?') + ' · 引怪半径 ' + pr.radius.toFixed(1) + 'm', cx, cy + 92);
      ctx.fillStyle = 'rgba(220,227,235,0.45)'; ctx.font = '10.5px ' + SANS;
      ctx.fillText('（半径按路径长度算，隔墙隔门会更短）', cx, cy + 108);
    }

    // 交互提示
    if (player.interactTarget) {
      const g = C.SoundSystem.graph, p = g.getPortal(player.interactTarget.portalId);
      const opening = !g.isPassable(p);
      const noun = player.interactTarget.kind === 'window' ? '窗' : '门';
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '12.5px ' + SANS;
      ctx.fillText(touch
        ? `轻点 F=快速${opening ? '开' : '关'}${noun}（吵）　按住=缓慢（安静）`
        : `[F] 轻点=快速${opening ? '开' : '关'}${noun}（吵）　按住=缓慢${opening ? '开' : '关'}（安静）`,
        cx, cy - (touch ? 54 : -46));
      if (player.interactProgress > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * player.interactProgress); ctx.stroke();
      }
    }

    // 前方可翻越的提示。与开门提示互斥，避免同一位置两行字打架。
    if (!player.interactTarget && !touch) {
      const v = player.vaultTarget && player.vaultTarget();
      if (v) {
        ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(220,227,235,0.9)'; ctx.font = '12.5px ' + SANS;
        ctx.fillText('[Space] 翻越 ' + v.rise.toFixed(2) + 'm', cx, cy + 46);
      }
    }

    // 手表（不常驻）
    if (this.showWatch) {
      ctx.textAlign = 'center'; ctx.font = '26px ' + MONO;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText('第 ' + time.day + ' 天  ' + time.format(), cx, H - 90);
    }

    if (C.Sleep && C.Sleep.active) {
      ctx.fillStyle = 'rgba(4,6,10,0.86)'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center'; ctx.fillStyle = '#DCE3EB'; ctx.font = '22px ' + SANS;
      ctx.fillText('睡眠中…', cx, cy - 8);
      ctx.font = '13px ' + MONO; ctx.fillStyle = SIGNAL;
      ctx.fillText(C.Sleep.slept.toFixed(1) + ' / ' + C.Sleep.target + ' 小时　' + time.format(), cx, cy + 20);
      ctx.fillStyle = 'rgba(220,227,235,0.5)'; ctx.font = '12px ' + SANS;
      ctx.fillText('有响度 margin > 15 的声音就会惊醒 · 按 K 主动起床', cx, cy + 44);
    }

    if (!player.alive) {
      ctx.fillStyle = 'rgba(20,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center'; ctx.fillStyle = '#E4573D';
      ctx.font = (touch ? '26px ' : '34px ') + SANS; ctx.letterSpacing = '0.3em'; ctx.fillText('你死了', cx, cy - 10); ctx.letterSpacing = '0px';
      ctx.font = '13px ' + SANS;
      ctx.fillText(player.deathCause || '', cx, cy + 24);
      ctx.fillText(touch ? '点击画面重新开始' : '按 R 重新开始', cx, cy + 52);
    }
  };

  /**
   * 声纹标记：画在声源头顶的世界坐标上，穿墙可见。
   * 做法是把世界坐标投影到屏幕，而不是在屏幕中心画方向环 ——
   * 后者只能告诉你「那边有动静」，前者直接告诉你「它就在那儿」。
   * 声源跑到画面外时收到屏幕边缘，变成一个指向它的三角。
   */
  Hud.prototype._soundprint = function (player, camera) {
    if (!camera || !root.THREE) return;
    const ctx = this.ctx, now = performance.now() / 1000, life = C.Config.debug.soundprintLifetime;
    const W = this.canvas.width, H = this.canvas.height, cx = W / 2, cy = H / 2;
    const v = this._proj || (this._proj = new root.THREE.Vector3());
    const pad = 46;

    for (const s of player.soundprints) {
      const age = (now - s.born) / life;
      if (age > 1 || !s.src) continue;
      const a = 1 - age;
      const col = COLORS[s.category] || COLORS._;

      v.set(s.src.x, s.src.y + 1.75, s.src.z);   // 挂在头顶
      v.project(camera);
      const behind = v.z > 1;
      let x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      if (behind) { x = W - x; y = H - y; }
      const off = behind || x < pad || x > W - pad || y < pad || y > H - pad;

      if (off) {
        // 收到屏幕边缘：沿中心→目标的方向压到内缩矩形上，画一个指向它的三角
        let dx = x - cx, dy = y - cy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const t = Math.min((W / 2 - pad) / Math.abs(dx || 1e-6), (H / 2 - pad) / Math.abs(dy || 1e-6));
        const ex = cx + dx * t, ey = cy + dy * t;
        ctx.save();
        ctx.translate(ex, ey); ctx.rotate(Math.atan2(dy, dx));
        const st2 = M.clamp(s.margin / C.Config.hearing.soundprintFullMargin, 0, 1);
        const sc = 0.65 + 0.5 * st2;
        ctx.fillStyle = 'rgba(' + col + ',' + (0.8 * a * (0.35 + 0.65 * st2)).toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(9 * sc, 0); ctx.lineTo(-6 * sc, 6 * sc); ctx.lineTo(-6 * sc, -6 * sc);
        ctx.closePath(); ctx.fill();
        ctx.restore();
        continue;
      }

      /* 明显度随「玩家实际听到的强度」变化：贴脸的动静又大又亮，
         勉强够到阈值的只是一个淡淡的小点。强度 = margin / 满强度 margin。 */
      const st = M.clamp(s.margin / C.Config.hearing.soundprintFullMargin, 0, 1);
      const emph = 0.35 + 0.65 * st;
      const bob = Math.sin(now * 3 + s.evtId) * 2.0;
      const yy = y + bob, r = 8 + 8 * st;
      // 刚响起的一瞬间往外扩一圈，用来抓眼睛
      if (age < 0.35) {
        const p = age / 0.35;
        ctx.strokeStyle = 'rgba(' + col + ',' + (0.5 * emph * (1 - p)).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, yy, r + p * 14, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(x, yy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,14,20,' + (0.6 * a * emph).toFixed(3) + ')'; ctx.fill();
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.95 * a * emph).toFixed(3) + ')';
      ctx.lineWidth = 1.1 + 0.9 * st; ctx.stroke();
      drawIcon(ctx, s.category, x, yy, r * 0.85, col, 0.95 * a * emph);
      // 一条短引线落到声源脚下，说明标记贴的是哪个东西
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.3 * a).toFixed(3) + ')'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yy + r); ctx.lineTo(x, yy + r + 11); ctx.stroke();
    }
  };

  C.Hud = Hud;
})(typeof globalThis !== 'undefined' ? globalThis : this);
