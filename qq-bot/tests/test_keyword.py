from src.core.keyword import match_keyword

REPLIES = {"早上好": "早上好呀", "好": "好的", "晚安": "晚安，好梦"}


def test_returns_none_when_no_keyword_hits() -> None:
    assert match_keyword("今天天气不错", REPLIES) is None
    assert match_keyword("早上好", {}) is None


def test_matches_substring() -> None:
    assert match_keyword("大家晚安啦", REPLIES) == "晚安，好梦"


def test_longer_keyword_wins() -> None:
    assert match_keyword("早上好", REPLIES) == "早上好呀"


def test_empty_keyword_is_ignored() -> None:
    assert match_keyword("随便说点什么", {"": "不该触发"}) is None
