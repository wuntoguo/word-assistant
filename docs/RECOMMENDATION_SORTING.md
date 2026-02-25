# 推荐排序与各阶段说明

## 一、数据源与分支

| 条件 | 数据来源 | 是否有 recommendationReason / scores |
|------|----------|-------------------------------------|
| 已登录 + recommend 成功 | `getRecommendedArticles` | ✅ 有 |
| 已登录 + recommend 失败 / 空 | `fetchArticles`（RSS） | ❌ 无 |
| 未登录 | `fetchArticles`（RSS） | ❌ 无 |

**前端逻辑**：`token` 存在时调用 `fetchRecommendArticles`，否则调用 `fetchArticles`。登录后会因 `token` 变化触发重新拉取推荐。

---

## 二、推荐排序逻辑（`getRecommendedArticles`）

### 阶段 1：缓存命中

当 `user_top_articles` 有数据时：

1. 从 `getUserTopArticlesWithArticle` 读取 Top 200
2. 只过滤已反馈（like/dislike）；**不再按「已展示」过滤**
3. 按展示次数降权：`score *= 1/(1 + 0.2×showCount)`
3. 按 `parent_id || id` 去重（同源取 difficulty 更高的）
4. **排序**：
   - `scoreWithFreshness = totalScore × (0.75 + 0.25 × freshness/100)`
   - `freshness = max(0, 100 - daysOld × 7)`，约 14 天衰减到 0
   - 按 `scoreWithFreshness` 降序

### 阶段 2：实时打分（无缓存）

1. 候选：`getArticlesForRecommendation(150, 21)`（近 21 天 150 篇）
2. 过滤：已反馈、3 天内展示、难度高于用户 2 档以上
3. 对每篇调用 `scoreArticleWithGPT`：
   - Interest：语义相似度（embedding）+ GPT 生成 reason
   - Difficulty：用户 level 与文章 level 的 gap
   - Total = 0.4×interest + 0.6×difficulty
4. dislike 重叠时：interest 扣 30
5. 按 `parent_id || id` 去重
6. **排序**：同阶段 1，按 `scoreWithFreshness` 降序
7. Top 100 写入 `user_top_articles`

### 阶段 3：无 API Key 或候选为空

- 按 `computeFreshnessScore` 降序（只看 freshness）

---

## 三、排序公式汇总

| 阶段 | 排序键 | 说明 |
|------|--------|------|
| 缓存 / 实时 | `scoreWithFreshness` | baseScore × (0.75 + 0.25×freshness/100) |
| baseScore | totalScore | 0.4×interest + 0.6×difficulty |
| freshness | 0–100 | 100 - daysOld×7，越新越高 |

---

## 四、预计算（`recommend-precompute`）

- 增量：`daily-crawl` 后有新文章 → `runIncrementalPrecompute`
- 全量：无缓存用户 → 对候选文章打分并写入
- 排序与上面相同，使用 embedding 相似度 + difficulty gap

---

## 五、展示次数与降权

- `user_shown_articles` 新增 `show_count`，每次展示 +1
- 不再按「已展示」过滤，所有候选都会参与排序
- 降权公式：`adjustedScore = baseScore × 1/(1 + 0.2×showCount)`
  - 0 次：1.0；1 次：0.83；5 次：0.5；10 次：0.33

## 六、推荐理由不展示的可能原因

1. **未登录** → 走 RSS，无 recommendationReason
2. **recommend 失败**（401 等）→ 静默 fallback 到 RSS
3. **初次加载时未登录** → 展示 RSS，登录后需依赖 `token` 变化触发重拉
