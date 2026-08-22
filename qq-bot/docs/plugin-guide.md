# 写一个新插件

以「查询今天星期几」为例。

## 1. 业务逻辑写进 src/core/

不依赖 NoneBot，纯函数，方便测试：

```python
# src/core/weekday.py
from datetime import date

WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"]


def weekday_text(day: date) -> str:
    return f"今天是星期{WEEKDAYS[day.weekday()]}"
```

## 2. 适配层写进 src/plugins/

```python
# src/plugins/weekday/__init__.py
from datetime import date

from nonebot import on_command
from nonebot.plugin import PluginMetadata

from src.core.weekday import weekday_text

__plugin_meta__ = PluginMetadata(
    name="weekday",
    description="查询今天星期几",
    usage="/weekday",
)

weekday = on_command("weekday", aliases={"星期几"}, priority=10, block=True)


@weekday.handle()
async def handle_weekday() -> None:
    await weekday.finish(weekday_text(date.today()))
```

目录放进 `src/plugins/` 就会被自动加载，不用改 `bot.py`。
写了 `__plugin_meta__` 的插件会自动出现在 `/help` 菜单里。

## 3. 补测试

```python
# tests/test_weekday.py
from datetime import date

from src.core.weekday import weekday_text


def test_weekday_text() -> None:
    assert weekday_text(date(2026, 8, 22)) == "今天是星期六"
```

## 常用写法速查

**取命令参数**

```python
from nonebot.adapters.onebot.v11 import Message
from nonebot.params import CommandArg

@matcher.handle()
async def _(args: Message = CommandArg()) -> None:
    text = args.extract_plain_text().strip()
```

**限定超级用户 / 群管理员**

```python
from nonebot.permission import SUPERUSER
from nonebot.adapters.onebot.v11 import GROUP_ADMIN, GROUP_OWNER

matcher = on_command("kick", permission=SUPERUSER | GROUP_ADMIN | GROUP_OWNER)
```

**只在被 @ 时触发**

```python
from nonebot.rule import to_me

matcher = on_command("chat", rule=to_me())
```

**多轮对话（追问）**

```python
from nonebot.params import ArgPlainText

@matcher.got("city", prompt="想查哪个城市？")
async def _(city: str = ArgPlainText()) -> None:
    await matcher.finish(f"你说的是 {city}")
```

**发图片 / at**

```python
from nonebot.adapters.onebot.v11 import MessageSegment

await matcher.finish(MessageSegment.at(user_id) + MessageSegment.image("file:///path/a.png"))
```

**插件自己的配置**

在 `src/plugins/<name>/config.py` 定义 pydantic 模型，字段名加插件前缀，
再在 `.env` 里写同名大写配置项，用 `nonebot.get_plugin_config(Config)` 读取，
可参考 `src/plugins/keyword/`。

**定时任务**

```bash
pip install nonebot-plugin-apscheduler
```

在 `pyproject.toml` 的 `[tool.nonebot.plugins]` 里加上 `default = ["nonebot_plugin_apscheduler"]`，
然后：

```python
from nonebot import require

require("nonebot_plugin_apscheduler")
from nonebot_plugin_apscheduler import scheduler


@scheduler.scheduled_job("cron", hour=8, minute=0)
async def morning_greeting() -> None:
    ...
```

更多写法见 [NoneBot2 官方文档](https://nonebot.dev/docs/)。
