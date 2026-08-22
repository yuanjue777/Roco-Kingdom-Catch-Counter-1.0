# qq-bot

基于 [NoneBot2](https://nonebot.dev/) + OneBot v11 协议的 QQ 机器人。

机器人本身不直接登录 QQ：由 NapCat / Lagrange 这类客户端负责登录并按 OneBot v11 协议
把消息通过 WebSocket 转发过来，本项目只负责处理消息和回复。

```
QQ 服务器  ⇄  NapCat（登录 QQ，实现 OneBot v11）  ⇄  本项目（NoneBot2，业务逻辑）
                                 反向 WebSocket
```

## 目录结构

```
bot.py                  入口，注册适配器并加载插件
pyproject.toml          依赖 + NoneBot 插件配置 + ruff/pytest 配置
.env                    选择运行环境（dev / prod）
.env.example            配置模板，复制成 .env.dev / .env.prod 后填写
src/core/               纯业务逻辑，不依赖 NoneBot，可直接单测
src/plugins/            插件（适配层），每个子目录是一个插件
tests/                  针对 src/core 的单元测试
docs/                   接入与开发文档
```

分层约定：**能写成纯函数的逻辑一律放 `src/core/`**，`src/plugins/` 只做「解析消息 →
调用 core → 回复」。这样测试不需要启动 NoneBot，换协议时业务代码也不用重写。

## 快速开始

```bash
# 1. 装依赖
pip install -r requirements.txt

# 2. 准备配置
cp .env.example .env.dev
#    改里面的 SUPERUSERS（你的 QQ 号）、ONEBOT_ACCESS_TOKEN 等

# 3. 启动
python bot.py
```

看到 `Running NoneBot...` 就说明起来了，此时它在 `0.0.0.0:8080` 等待 OneBot 客户端接入。
接下来按 [docs/napcat.md](docs/napcat.md) 配置 NapCat 连过来。

## 内置插件

| 插件 | 命令 | 说明 |
| --- | --- | --- |
| ping | `/ping`、`在吗` | 连通性测试，最小示例 |
| menu | `/help`、`菜单` | 自动汇总所有插件的功能菜单 |
| roll | `/roll 2d6+1` | 骰子，演示命令参数解析 |
| status | `/status` | 运行状态，演示超级用户权限 |
| keyword | 群内说出关键词 | 关键词自动回复，演示配置驱动 |

关键词词表写在 `.env.dev` 里，改词不用改代码：

```dotenv
KEYWORD_REPLIES={"早上好": "早上好呀！", "晚安": "晚安，好梦~"}
KEYWORD_GROUPS=[123456789]
```

## 开发

```bash
pytest -q              # 单元测试
ruff check .           # 静态检查
ruff format .          # 格式化
```

新增插件见 [docs/plugin-guide.md](docs/plugin-guide.md)。

## 部署

```bash
cp .env.example .env.prod   # 填好生产配置
docker compose up -d
docker compose logs -f napcat   # 首次启动扫码登录 QQ
```

## 关于仓库位置

这份代码暂时放在 `Roco-Kingdom-Catch-Counter-1.0` 仓库的 `qq-bot/` 子目录下，
拆成独立仓库的步骤见 [docs/standalone-repo.md](docs/standalone-repo.md)。

## 安全提醒

- `.env.dev` / `.env.prod` 已被 `.gitignore` 忽略，**不要**把填了 token 的配置提交上去。
- OneBot 的 `ONEBOT_ACCESS_TOKEN` 一定要设，否则任何能访问 8080 端口的人都能操控机器人。
- 用第三方客户端登录 QQ 存在账号风险，建议用小号。
