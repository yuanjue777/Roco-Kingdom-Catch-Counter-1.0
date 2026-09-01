/*
 * 15-debug.js —— 声音可视化调试工具 + 实时调参面板
 * 对应主文档 13.2 风险三：「玩家听不见的东西很难 debug，必须在 M0 就做一个可视化调试工具」。
 * Tab 切换俯视图：实时显示每个节点的当前响度、每只丧尸的 margin 和目标点。
 */
(function (root) {
  const C = (root.Campus = root.Campus || {});
  const { AABB, V, M } = C;

  const STATE_COLOR = {
    '游荡': '#8ab4f8', '警觉': '#ffd479', '调查': '#ff9f43', '搜索': '#c58af9', '追击': '#ff5c5c', '趴伏': '#7f8c8d'
  };
  const PORTAL_COLOR = { Open: '#4cd97b', Closed: '#e05555', Broken: '#e0c455', Blocked: '#7a4a4a' };

  function Debug(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.visible = false;
    this.floor = 0;
    this.followPlayer = true;
  }

  Debug.prototype.draw = function (level, player, time) {
    if (!this.visible) return;
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.fillStyle = 'rgba(8,10,16,0.94)'; ctx.fillRect(0, 0, W, H);

    const H_ = level.bounds.floorHeight;
    if (this.followPlayer) this.floor = M.clamp(Math.round(player.pos.y / H_), 0, level.bounds.floors - 1);
    const b = level.bounds;
    const padL = 20, padR = 340, padT = 56, padB = 20;
    const sx = (W - padL - padR) / (b.maxX - b.minX);
    const sz = (H - padT - padB) / (b.maxZ - b.minZ);
    const s = Math.min(sx, sz);
    const toX = (x) => padL + (x - b.minX) * s;
    const toY = (z) => padT + (z - b.minZ) * s;

    const result = C.SoundSystem.lastResult;
    const evt = C.SoundSystem.lastEvent;

    // ── 节点：填色 = 上一次声音事件在该节点入口的到达响度 ──
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
    for (const n of level.graph.nodes) {
      const onFloor = n.isOutdoor || n.floor === this.floor;
      if (!onFloor) continue;
      const x0 = toX(n.bounds.min.x), y0 = toY(n.bounds.min.z);
      const w = (n.bounds.max.x - n.bounds.min.x) * s, h = (n.bounds.max.z - n.bounds.min.z) * s;
      const rec = result && result.get(n.id);
      if (rec) {
        const t = M.clamp(rec.arrival / 90, 0, 1);
        ctx.fillStyle = `hsla(${(1 - t) * 200}, 85%, ${18 + t * 34}%, 0.92)`;
      } else ctx.fillStyle = n.isOutdoor ? 'rgba(30,42,32,0.7)' : 'rgba(32,36,46,0.85)';
      ctx.fillRect(x0, y0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0, w, h);
      if (w > 34 && h > 18) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText(n.name, x0 + w / 2, y0 + 13);
        if (rec) {
          ctx.fillStyle = '#ffe08a';
          ctx.fillText(rec.arrival.toFixed(1), x0 + w / 2, y0 + 26);
        }
      }
    }

    // ── Portal：颜色 = 状态 ───────────────────────────
    for (const p of level.graph.portals) {
      const a = level.graph.getNode(p.nodeA), bb = level.graph.getNode(p.nodeB);
      const show = (a.isOutdoor || a.floor === this.floor) && (bb.isOutdoor || bb.floor === this.floor);
      if (!show) continue;
      ctx.fillStyle = PORTAL_COLOR[p.state] || '#fff';
      ctx.fillRect(toX(p.position.x) - 3, toY(p.position.z) - 3, 6, 6);
    }
    // 竖向楼梯口单独标出来
    for (const p of level.graph.portals) {
      if (p.type !== 'Stairwell') continue;
      const a = level.graph.getNode(p.nodeA);
      if (a.floor !== this.floor && level.graph.getNode(p.nodeB).floor !== this.floor) continue;
      ctx.strokeStyle = '#5ad'; ctx.lineWidth = 2;
      ctx.strokeRect(toX(p.position.x) - 7, toY(p.position.z) - 7, 14, 14);
    }

    // ── 声源 ─────────────────────────────────────────
    if (evt) {
      ctx.strokeStyle = 'rgba(255,220,120,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(toX(evt.worldPosition.x), toY(evt.worldPosition.z), 9, 0, Math.PI * 2); ctx.stroke();
    }

    // ── 丧尸：状态色 + margin + 目标点 + 定位误差圈 ──
    for (const z of C.ZombieManager.list) {
      if (!z.alive) continue;
      const zx = toX(z.pos.x), zy = toY(z.pos.z);
      const sameFloor = Math.round(z.pos.y / H_) === this.floor;
      ctx.globalAlpha = sameFloor ? 1 : 0.28;
      if (z.target) {
        ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(zx, zy); ctx.lineTo(toX(z.target.x), toY(z.target.z)); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,160,80,0.85)';
        ctx.beginPath(); ctx.arc(toX(z.target.x), toY(z.target.z), 4, 0, Math.PI * 2); ctx.stroke();
        if (z.targetTrue && z.targetError > 0) {
          ctx.strokeStyle = 'rgba(255,160,80,0.22)';
          ctx.beginPath(); ctx.arc(toX(z.targetTrue.x), toY(z.targetTrue.z), z.targetError * s, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.fillStyle = STATE_COLOR[z.state] || '#fff';
      ctx.beginPath(); ctx.arc(zx, zy, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(zx, zy);
      ctx.lineTo(zx + Math.sin(z.yaw) * 14, zy + Math.cos(z.yaw) * 14); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(z.state + ' m=' + z.currentMargin.toFixed(0), zx, zy - 10);
      ctx.globalAlpha = 1;
    }

    // ── 玩家 ─────────────────────────────────────────
    const px = toX(player.pos.x), py = toY(player.pos.z);
    ctx.fillStyle = '#7cf07c';
    ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7cf07c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py);
    ctx.lineTo(px - Math.sin(player.yaw) * 18, py - Math.cos(player.yaw) * 18); ctx.stroke();

    this._panel(ctx, W, H, padR, level, player, time);
  };

  Debug.prototype._panel = function (ctx, W, H, padR, level, player, time) {
    const x = W - padR + 14;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText('声音调试视图', 20, 30);
    ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('Tab 关闭 · [ ] 切换楼层 · 当前 ' + (this.floor + 1) + 'F' +
                 (this.followPlayer ? '（跟随玩家，按 \\ 取消）' : ''), 150, 30);

    let y = 58;
    const line = (t, c) => { ctx.fillStyle = c || 'rgba(255,255,255,0.85)'; ctx.fillText(t, x, y); y += 17; };
    ctx.font = '12px ui-monospace, monospace';
    const st = C.SoundSystem.stats;
    line('时间  第' + time.day + '天 ' + time.format() + '  夜间系数 ' + time.getNightFactor().toFixed(2));
    line('传播  ' + st.lastMs.toFixed(3) + ' ms / ' + st.lastExpanded + ' 节点  （预算 0.5ms）',
         st.lastMs > 0.5 ? '#ff8a8a' : '#8de08d');
    line('事件  ' + st.eventsThisSecond + ' 次/秒  峰值 ' + st.peakPerSecond + '  （预算 40）',
         st.peakPerSecond > 40 ? '#ff8a8a' : '#8de08d');
    const counts = C.ZombieManager.countByState();
    line('丧尸  ' + Object.keys(counts).map(k => k + ':' + counts[k]).join('  '));
    line('玩家  阈值 ' + player.hearing.finalThreshold().toFixed(0) +
         '  定位 ' + player.hearing.finalLocalization().toFixed(2) +
         '  节点 ' + (level.graph.getNode(player.nodeId) || {}).name);
    const key = player.baseLoudnessKey();
    const base = key ? C.Config.loudness[key] : 0;
    line('脚步  ' + (key || '静默') + ' 基础' + base + ' → 最终 ' +
         C.ModifierPipeline.query('sound.footstep', base, player.id).toFixed(1));
    y += 6;
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText('── 声音事件流 ──', x, y); y += 18;
    const log = C.SoundSystem.log.slice(-16).reverse();
    for (const e of log) {
      const n = level.graph.getNode(e.node);
      ctx.fillStyle = e.emitter === C.PLAYER_ID ? '#8de08d' : (e.emitter >= 100 ? '#ff9a9a' : '#d8d8d8');
      ctx.fillText(`${String(e.loud).padStart(3)}  ${(e.label || e.cat).slice(0, 10).padEnd(10)} @${n ? n.name : '?'}`, x, y);
      y += 15;
      if (y > H - 20) break;
    }
  };

  // ── 实时调参面板 ─────────────────────────────────
  const TUNABLES = [
    ['sound.kIndoor', '室内衰减 k', 0.5, 4, 0.1],
    ['sound.kOutdoor', '室外衰减 k', 0.5, 4, 0.1],
    ['time.nightFactor', '夜间系数', 0.4, 1, 0.05],
    ['time.secondsPerGameHour', '1游戏小时(秒)', 20, 200, 5],
    ['loudness.walk', '走路响度', 0, 60, 1],
    ['loudness.run', '奔跑响度', 0, 90, 1],
    ['loudness.crouch', '蹲行响度', 0, 40, 1],
    ['loudness.stoneImpact', '石头响度', 0, 90, 1],
    ['loudness.crawlerBreath', '蜷伏者呼吸响度', 0, 40, 1],
    ['loudness.zombieGrowl', '追击低吼响度', 0, 90, 1],
    ['hearing.zombie', '丧尸阈值', 1, 40, 1],
    ['hearing.player', '玩家阈值', 1, 60, 1],
    ['hearing.playerHoldBreath', '屏息阈值', 1, 40, 1],
    ['zombieReaction.maxChasers', '同时追击上限', 1, 30, 1],
    ['zombieReaction.chainMaxDepth', '连锁层数上限', 0, 5, 1],
    ['zombieReaction.investigateSpeedMul', '调查速度倍率', 0.5, 4, 0.1],
    ['player.speedWalk', '走路速度', 0.5, 6, 0.1],
    ['player.speedRun', '奔跑速度', 1, 9, 0.1],
    ['player.weightRatio', '负重比 r', 0, 1.5, 0.05],
    ['skills.quietStep.level', '静步熟练度', 0, 5, 1],
    ['skills.hearing.level', '听觉熟练度', 0, 5, 1]
  ];

  function get(path) { return path.split('.').reduce((o, k) => o[k], C.Config); }
  function set(path, v) {
    const ks = path.split('.'); const last = ks.pop();
    ks.reduce((o, k) => o[k], C.Config)[last] = v;
  }

  Debug.buildTuner = function (container) {
    container.innerHTML = '<h3>实时调参 <small>（P 开关 · 立即生效 · 不写回文件）</small></h3>';
    for (const [path, label, min, max, step] of TUNABLES) {
      const row = document.createElement('label');
      row.className = 'tune-row';
      row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${get(path)}"><b>${get(path)}</b>`;
      const input = row.querySelector('input'), out = row.querySelector('b');
      input.addEventListener('input', () => { set(path, parseFloat(input.value)); out.textContent = input.value; });
      container.appendChild(row);
    }
    const btn = document.createElement('button');
    btn.textContent = '恢复文档默认值';
    btn.onclick = () => {
      for (const [path] of TUNABLES) set(path, path.split('.').reduce((o, k) => o[k], C.ConfigDefaults));
      Debug.buildTuner(container);
    };
    container.appendChild(btn);
  };

  C.Debug = Debug;
})(typeof globalThis !== 'undefined' ? globalThis : this);
