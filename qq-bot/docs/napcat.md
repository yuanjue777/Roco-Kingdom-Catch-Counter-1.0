# 接入 NapCat（让机器人收到 QQ 消息）

本项目实现的是 OneBot v11 的服务端，需要一个负责登录 QQ 的客户端连过来。
下面以 [NapCat](https://github.com/NapNeko/NapCatQQ) 为例，Lagrange、go-cqhttp 同理。

## 1. 先把机器人跑起来

```bash
python bot.py
```

它会监听 `.env.dev` 里配置的 `HOST:PORT`（默认 `0.0.0.0:8080`），
OneBot v11 的反向 WebSocket 接入点是：

```
ws://<机器人地址>:8080/onebot/v11/ws
```

## 2. 启动 NapCat 并登录

```bash
docker compose up -d napcat
docker compose logs -f napcat    # 扫描日志里的二维码登录
```

## 3. 配置反向 WebSocket

打开 NapCat WebUI（`http://<服务器地址>:6099`），新增一个 **WebSocket 客户端**（反向 WS）：

| 配置项 | 值 |
| --- | --- |
| URL | `ws://bot:8080/onebot/v11/ws`（docker compose 内）或 `ws://127.0.0.1:8080/onebot/v11/ws` |
| Token | 与 `.env` 里的 `ONEBOT_ACCESS_TOKEN` 完全一致 |
| 启用 | 是 |

保存后机器人日志里会出现：

```
Bot 123456789 connected
```

这时在群里发 `/ping`，机器人回 `pong` 就算通了。

## 常见问题

**机器人没反应**
- 确认日志里有 `Bot xxx connected`，没有说明 WS 没连上：检查 URL、端口和防火墙。
- 群消息需要机器人在群内，且没被禁言。

**连上了但提示鉴权失败**
- `ONEBOT_ACCESS_TOKEN` 两边必须一致；改完要重启机器人。

**命令要不要带斜杠**
- 由 `.env` 的 `COMMAND_START` 决定。默认 `["/", ""]` 表示 `/ping` 和 `ping` 都能触发；
  只想要斜杠就改成 `["/"]`。
