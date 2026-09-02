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

  const ICONS = { Footstep: '足', Impact: '击', Voice: '吼', Door: '门', Ambient: '息', Gunshot: '枪' };
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

    // 体力条。触屏时挪到左上角 —— 左下角被虚拟摇杆占了，右下角被动作键占了。
    const touch = C.Touch && C.Touch.enabled;
    const S = C.Config.player.stamina;
    const bw = touch ? 150 : 220, bh = touch ? 9 : 12;
    const bx = touch ? 16 : 28, by = touch ? 26 : H - 46;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    ctx.fillStyle = player.exhausted ? ACCENT : SIGNAL;
    ctx.fillRect(bx, by, bw * (player.stamina / S.max), bh);
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
        ctx.fillStyle = 'rgba(' + col + ',' + (0.8 * a).toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, 6); ctx.lineTo(-6, -6); ctx.closePath(); ctx.fill();
        ctx.restore();
        continue;
      }

      const bob = Math.sin(now * 3 + s.evtId) * 2.5;
      const r = 11;
      ctx.beginPath(); ctx.arc(x, y + bob, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,14,20,' + (0.55 * a).toFixed(3) + ')'; ctx.fill();
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.95 * a).toFixed(3) + ')'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = 'rgba(' + col + ',' + (0.95 * a).toFixed(3) + ')';
      ctx.font = '11px ' + SANS; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ICONS[s.category] || '?', x, y + bob + 0.5);
      // 一条短引线落到声源脚下，说明标记贴的是哪个东西
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.35 * a).toFixed(3) + ')'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y + bob + r); ctx.lineTo(x, y + bob + r + 10); ctx.stroke();
      ctx.textBaseline = 'alphabetic';
    }
  };

  C.Hud = Hud;
})(typeof globalThis !== 'undefined' ? globalThis : this);
