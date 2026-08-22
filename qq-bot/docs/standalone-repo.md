# 把 qq-bot 拆成独立仓库

这份代码目前放在 `Roco-Kingdom-Catch-Counter-1.0` 仓库的 `qq-bot/` 子目录里
（自动创建仓库时 GitHub App 权限不足，只能先落在这里）。
QQ 机器人和抓捕计数器是两个不相干的项目，建议尽快拆开。

顺带一提，`.github/workflows/ci.yml` 现在**不会运行**——GitHub 只识别仓库根目录下的
`.github/workflows/`，拆成独立仓库后它才会自动生效。

## 1. 在 GitHub 上手动新建仓库

打开 https://github.com/new ，仓库名填 `qq-bot`，选 **Private**，
**不要**勾选 Add a README / .gitignore / license（保持空仓库，避免推送冲突）。

## 2. 把子目录推成独立仓库

```bash
# 在本机任意目录执行
git clone https://github.com/yuanjue777/Roco-Kingdom-Catch-Counter-1.0.git
cd Roco-Kingdom-Catch-Counter-1.0
git checkout claude/qq-bot-repo-k5midx

# 只保留 qq-bot/ 的历史，并把它提升为仓库根目录
git subtree split --prefix=qq-bot -b qq-bot-only

# 推到新仓库
git push https://github.com/yuanjue777/qq-bot.git qq-bot-only:main
```

如果不在意历史，更简单的做法是直接复制文件：

```bash
git clone https://github.com/yuanjue777/qq-bot.git
cp -r Roco-Kingdom-Catch-Counter-1.0/qq-bot/. qq-bot/
cd qq-bot && git add -A && git commit -m "init: NoneBot2 QQ 机器人骨架" && git push
```

## 3. 清理原仓库

确认新仓库内容无误后，在原仓库删掉 `qq-bot/` 目录即可。
