"""关键词匹配逻辑，与 NoneBot 无关，便于单测。"""


def match_keyword(text: str, replies: dict[str, str]) -> str | None:
    """返回命中的回复内容；未命中返回 None。

    多个关键词同时命中时，优先返回更长（更具体）的那一个。
    """
    for keyword in sorted(replies, key=len, reverse=True):
        if keyword and keyword in text:
            return replies[keyword]
    return None
