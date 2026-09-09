# 《校园》· 网页原型（M3）

末日生存 · 第一人称 3D · **没有武器，没有战斗，只有声音。**

> ## 📖 先读这一份 → [`docs/设计文档-v3.md`](docs/设计文档-v3.md)
>
> 它是这个项目的**唯一事实来源**：每个系统一句话定位 + 数据表 + 规则 + 踩过的坑。
> `docs/` 下的 v1 / v2 已归档，**不要读**。

---

## 怎么跑

```bash
cd web-m0
node test/run-tests.js  test/sim-ai.js  test/sim-kitchen.js \
     test/sim-tutorial.js  test/sim-traits.js  test/sim-world.js   # 共 750 条
npx http-server -p 8080 .        # http://127.0.0.1:8080/index.html
node build.js                    # dist/campus-m0.html（片段）+ -standalone.html（离线单文件）
```

URL 参数：`?map=dorm` 单栋宿舍楼 ｜ `?char=guard` 跳过选人 ｜ `?skiptut` 跳过教学 ｜ `?touch=1` 强制触屏。

## 现在能玩到什么

选角色与特性 → 在宿舍 402 醒来 → 搜刮、背包、需求 → 屏息听声、投石、潜行 →
把电水壶摆到桌上、拉线插座、下一楼推闸、加水烧开（**听哨响判断水开了**）→
封锁房间睡觉 → 走出宿舍楼，教学 UI 永久消失。

全校 13 栋楼 / 320 只丧尸 / 651 个容器 / 274 个插座 / 32 个烹饪配方 / 53 条可选特性。

## 目录

```
web-m0/src/     00 配置（所有数字的唯一出处）· 01–39 分层实现
web-m0/test/    六套无头测试，不需要浏览器
docs/           设计文档-v3.md（唯一事实来源）+ 归档
```
