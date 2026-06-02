# v1.8 飞书表结构和标签库闭环

版本：v1.8.0-alpha.2

## 目标

v1.8 不继续扩展 AI 准确性和多平台能力，先把工具逻辑收敛到可做大功能用户体验测试的状态：

- 主表减少列数，只保留游戏评测最终需要看的结果。
- 玩法、题材、画风、特色标签等分类选项从飞书标签库同步。
- AI 发现现有列表没有的分类时，先进入建议流程，再由人工确认是否加入标签库。
- 工具界面减少重复入口，让批量队列、字段预检和标签维护更容易理解。

## 推荐飞书表结构

### 1. 评测结果主表

主表只放每款游戏的结果和状态，避免几十列堆满采集日志。

建议保留：

- `Game ID`：游戏唯一 ID
- `Game Name`：游戏名称
- `Source URL`：原始提交链接
- `Resolved Playable URL`：工具识别到的可试玩链接
- `Status`：评测状态
- `Game Type`：游戏大类
- `Gameplay`：主玩法或玩法结果
- `Theme`：题材
- `Art Style`：画风
- `Feature Tags`：特色标签
- `Product Overview`：英文产品简介
- `How To Play`：英文玩法说明
- `FAQ`：英文 FAQ
- `Needs Taxonomy Review`：是否需要分类复核
- `Review Status`：人工复核状态
- `Review Notes`：人工复核备注
- `Screenshot Attachments`：截图附件

### 2. Taxonomy Options 标签库表

当前已经配置并同步的正式标签库表，现有 table_id：

`tbl75983574oZNGA`

建议字段：

- `Category`：分类类型，例如 gameplay_types、themes、art_styles、feature_tags
- `Option ID`：稳定选项 ID
- `Parent ID`：父级选项，可选
- `Level`：层级，可选
- `Name EN`：英文名
- `Name ZH`：中文名
- `Enabled`：是否启用
- `Description ZH`：中文说明

当前已同步 49 个选项，包含：

- `gameplay_types`
- `themes`
- `art_styles`
- `feature_tags`
- `audiences`
- `controls`

### 3. Taxonomy Suggestions 标签建议表

后续新增，用于承接 AI 认为“现有标签库没有合适选项”的情况。

建议字段：

- `Game ID`：来源游戏
- `Category`：建议所属分类
- `Suggested Name EN`：建议英文名
- `Suggested Name ZH`：建议中文名
- `Reason`：AI 建议理由
- `Status`：Pending / Accepted / Rejected / Merged
- `Created At`：创建时间
- `Written Back At`：写回标签库时间

## v1.8 优先事项

1. 确认最终主表字段需求，避免主表继续膨胀。
2. 优先处理题材、画风、特色标签的多选列表同步和写入前校验。
3. 确认 `Art Style` 在最终评测结果表里是否为多选，当前工具检查到的远端字段仍是单选。
4. 增加分类缺失建议流程：不在标签库中的值先进入建议，不直接写正式字段。
5. 增加轻量队列管理：清空队列、移除单项。
6. 降级旧 POC Workbench、raw JSON 预览和重复入口。

## 暂缓内容

- v1.9 再集中处理 AI 准确性。
- v2.0 多平台、小程序、App、真机或云真机能力暂缓。
- 本阶段不把时间花在新的测试链接验证上，先准备用户体验反馈和工具逻辑调整。
