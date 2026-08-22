"""机器人入口。

启动方式：
    python bot.py
或使用 nb-cli：
    nb run
"""

import nonebot
from nonebot.adapters.onebot.v11 import Adapter as OneBotV11Adapter

# 读取 .env / .env.{ENVIRONMENT} 中的配置
nonebot.init()

driver = nonebot.get_driver()
driver.register_adapter(OneBotV11Adapter)

# 按 pyproject.toml 的 [tool.nonebot] 段加载插件
nonebot.load_from_toml("pyproject.toml")

if __name__ == "__main__":
    nonebot.run()
