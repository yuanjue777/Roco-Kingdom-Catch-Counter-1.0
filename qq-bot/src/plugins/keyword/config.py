from pydantic import BaseModel, Field


class Config(BaseModel):
    """对应 .env 中以 KEYWORD_ 开头的配置项。"""

    keyword_replies: dict[str, str] = Field(default_factory=dict)
    """关键词 -> 回复内容。"""

    keyword_groups: list[int] = Field(default_factory=list)
    """生效的群号，空列表表示所有会话。"""
