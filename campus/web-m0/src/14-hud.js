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

  Hud.prototype.draw = function (player, time, dt) {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;

    // 准星
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.stroke();

    // 声纹指示环（只在屏息时显示）
    if (player.holdBreath || C.Config.debug.showSoundprintAlways) this._soundprint(player, cx, cy);

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

  Hud.prototype._soundprint = function (player, cx, cy) {
    const ctx = this.ctx, now = performance.now() / 1000, life = C.Config.debug.soundprintLifetime;
    const R = Math.min(150, Math.min(this.canvas.width, this.canvas.height) * 0.40);
    const forward = player.yaw + Math.PI;
    ctx.save();
    // 底环
    ctx.strokeStyle = 'rgba(180,220,255,0.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

    for (const s of player.soundprints) {
      const age = (now - s.born) / life;
      if (age > 1) continue;
      const rel = M.wrapAngle(s.angle - forward);
      // 距离分级决定扇区所在的圈层，越近越靠内
      const rr = R * (s.band === '很近' ? 0.62 : s.band === '中等' ? 0.82 : 1.0);
      const half = (s.spread || 0.35) * 0.5;
      const a = (1 - age);
      const col = COLORS[s.category] || COLORS._;
      // 屏幕角与世界角的换算：0 在正上方，顺时针为正
      const a0 = rel - half - Math.PI / 2, a1 = rel + half - Math.PI / 2;
      const w = 9 + 5 * a;
      const grad = ctx.createRadialGradient(cx, cy, rr - w, cx, cy, rr + w);
      grad.addColorStop(0, 'rgba(' + col + ',0)');
      grad.addColorStop(0.5, 'rgba(' + col + ',' + (0.85 * a).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.strokeStyle = grad; ctx.lineWidth = w * 2; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a1); ctx.stroke();
      // 扇区中点的类别图标
      const mx = cx + Math.cos(rel - Math.PI / 2) * rr, my = cy + Math.sin(rel - Math.PI / 2) * rr;
      ctx.fillStyle = 'rgba(' + col + ',' + (0.95 * a).toFixed(3) + ')';
      ctx.font = '11px ' + SANS; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ICONS[s.category] || '?', mx, my);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  };

  C.Hud = Hud;
})(typeof globalThis !== 'undefined' ? globalThis : this);
