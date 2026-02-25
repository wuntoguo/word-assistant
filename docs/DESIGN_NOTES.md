# Design Notes (Original)

Original product concept and technical considerations.

## Product Concept

> 我每天会阅读一些英语文章或者网站，遇到不会的词：
> 1. 查询时给出英文发音、IPA 美式音标、简单英语解释、两个例句
> 2. 帮助记录每天查询的单词，根据记忆曲线测试、记忆
> 3. 每周可查询当周单词 list，可导出

## Technical Choices

- **Dictionary**: Free Dictionary API, 发音用 react-audio-player
- **Storage**: localStorage / indexedDB，定期同步
- **Spaced Repetition**: 记忆曲线、Ebbinghaus 间隔算法
- **UI**: Tailwind, recharts, react-icons, framer-motion
- **Routing**: HashRouter 避免服务端配置
