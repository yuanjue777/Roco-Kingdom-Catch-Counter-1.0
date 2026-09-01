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

    // 体力条
    const S = C.Config.player.stamina;
    const bw = 220, bh = 12, bx = 28, by = H - 46;
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
    if (player.flashlight) tags.push('手电');
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '12.5px ' + SANS;
    ctx.fillText(tags.join(' · ') || '站立', bx, by + 30);

    // 手中物品 / 快取
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '12px ' + MONO;
    ctx.fillText('石头 ×' + player.stones, W - 28, H - 28);
    if (player.charge > 0) {
      const cw = 120;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(W - 28 - cw, H - 22, cw, 6);
      ctx.fillStyle = '#ffd479'; ctx.fillRect(W - 28 - cw, H - 22, cw * player.charge, 6);
    }

    // 交互提示
    if (player.interactTarget) {
      const g = C.SoundSystem.graph, p = g.getPortal(player.interactTarget.portalId);
      const opening = !g.isPassable(p);
      const noun = player.interactTarget.kind === 'window' ? '窗' : '门';
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '12.5px ' + SANS;
      ctx.fillText(`[F] 轻点=快速${opening ? '开' : '关'}${noun}（吵）　按住=缓慢${opening ? '开' : '关'}（安静）`, cx, cy + 46);
      if (player.interactProgress > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * player.interactProgress); ctx.stroke();
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
      ctx.font = '34px ' + SANS; ctx.letterSpacing = '0.3em'; ctx.fillText('你死了', cx, cy - 10); ctx.letterSpacing = '0px';
      ctx.font = '13px ' + SANS;
      ctx.fillText(player.deathCause || '', cx, cy + 24);
      ctx.fillText('按 R 重新开始', cx, cy + 52);
    }
  };

  Hud.prototype._soundprint = function (player, cx, cy) {
    const ctx = this.ctx, now = performance.now() / 1000, life = C.Config.debug.soundprintLifetime;
    ctx.save();
    ctx.strokeStyle = 'rgba(180,220,255,0.14)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, 150, 0, Math.PI * 2); ctx.stroke();
    const forward = player.yaw + Math.PI;
    for (const s of player.soundprints) {
      const age = (now - s.born) / life;
      if (age > 1) continue;
      const rel = M.wrapAngle(s.angle - forward);
      // 距离分级决定指示环半径：很近的画在里圈
      const R = s.band === '很近' ? 92 : s.band === '中等' ? 124 : 150;
      const x = cx + Math.sin(rel) * R, y = cy - Math.cos(rel) * R;
      const a = (1 - age) * 0.95;
      ctx.fillStyle = `rgba(111,211,232,${a})`;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(8,14,22,${a})`;
      ctx.font = '11px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ICONS[s.category] || '?', x, y + 0.5);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  };

  C.Hud = Hud;
})(typeof globalThis !== 'undefined' ? globalThis : this);
