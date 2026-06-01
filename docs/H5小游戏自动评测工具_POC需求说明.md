# H5 小游戏自动评测工具 POC 需求说明

## 1. POC 目标

验证 H5 网页游戏评测流程是否能跑通：

- 输入一个 H5 游戏链接。
- 自动打开页面并采集基础信息。
- 使用本地模拟表读取可配置的玩法、题材、画风、标签等字段库。
- 本地生成一款游戏一个证据文件夹。
- 输出后台中文结果，导出英文评测内容。
- 预留后续接入飞书多维表格、AI API Key、AI 自动操作的扩展位置。

## 2. 首个样本游戏

| 项目 | 内容 |
|---|---|
| 游戏链接 | https://go.minigame.group/game/cow-saver/play |
| 用途 | POC 第一条端到端样本 |
| POC 建议试玩时长 | 3-5 分钟 |
| 正式评测试玩时长 | 30 分钟 |

说明：POC 阶段先跑短时长，用来确认流程、目录、字段和报告结构。流程稳定后再切换到 30 分钟。

## 3. 输入

POC 第一版输入：

- 单个 H5 游戏 URL。
- 本地模拟配置表，位于 `mock_bitable/`。
- 测试设备范围：
  - 手机竖屏。
  - 手机横屏。
  - 桌面浏览器。
- 网络环境：
  - 正常网络。
  - Slow 4G。

后续 V1 输入：

- 批量游戏链接。
- 飞书多维表格配置库。
- AI Provider、模型名称、API Key。
- 试玩时长和设备矩阵配置。

## 4. 输出

POC 第一版输出到本地文件夹：

```text
evidence/
  cow-saver/
    screenshots/
    video/
    network/
    traces/
    report.zh.json
    report.en.json
```

输出原则：

- 后台展示中文。
- 导出内容英文。
- 每个字段保留 `confidence` 和 `evidence`。
- 无法从现有配置库选择时，输出新增建议，不直接写入正式标签库。

示例：

```json
{
  "game_type": {
    "selected": ["Puzzle"],
    "new_suggestions": ["Rescue Puzzle"],
    "needs_taxonomy_review": true,
    "confidence": 0.78
  }
}
```

## 5. 飞书多维表格接入方案

POC 阶段先不直接接飞书，使用本地 CSV 模拟多维表格。

后续接入飞书时，推荐使用飞书开放平台 API / 多维表格 API，而不是飞书 CLI。

首次接入飞书的操作指南见：

```text
docs/飞书接入用户操作指南.md
```

需要的访问配置通常包括：

| 配置项 | 用途 | 获取方式 |
|---|---|---|
| App ID | 标识飞书自建应用 | 飞书开放平台创建企业自建应用后获得 |
| App Secret | 后端换取访问令牌 | 飞书开放平台应用凭证页面获得 |
| App Token | 指定某个多维表格应用 | 打开飞书多维表格，从 URL 或开放平台文档说明中获取 |
| Table ID | 指定多维表格里的某张数据表 | 通过 API 查询表列表，或从多维表格 URL/开发者工具获取 |
| View ID | 可选，指定视图 | 需要按某个视图读取时使用 |
| Field ID / Field Name | 字段映射 | 通过 API 查询字段列表，或人工维护字段映射 |
| 权限范围 | 允许读取/写入多维表格 | 在飞书开放平台给应用开通对应权限 |
| 应用安装状态 | 允许应用访问企业数据 | 企业管理员安装或授权应用 |

安全要求：

- App Secret 和 AI API Key 只放后端环境变量。
- 不放在前端页面。
- 本地开发可使用 `.env`，但不要提交真实密钥。

## 6. 本地模拟多维表格

POC 先建立这些本地表：

| 本地表 | 对应飞书多维表格 | 作用 |
|---|---|---|
| `mock_bitable/gameplay_types.csv` | 玩法类型库 | 游戏类型、细分类型、玩法选择 |
| `mock_bitable/themes.csv` | 题材库 | 游戏题材选择 |
| `mock_bitable/art_styles.csv` | 画风库 | 画风选择 |
| `mock_bitable/feature_tags.csv` | 特色标签库 | 特色标签多选 |
| `mock_bitable/audiences.csv` | 适合人群库 | 适合人群选择 |
| `mock_bitable/controls.csv` | 操作方式库 | Controls 字段选择 |
| `mock_bitable/output_fields.csv` | 输出字段定义 | 字段名称、输出语言、是否枚举 |

后续飞书接入时，这些 CSV 的结构可以迁移成飞书多维表格。

## 7. 字段选择列表是否需要人工提供

建议分两阶段处理。

第一阶段，POC：

- 不要求你一次提供完整选择列表。
- 先使用一套初始配置库。
- AI 优先从配置库中选择。
- 不在库里的内容进入 `new_suggestions`。

第二阶段，V1/V2：

- 你或团队在飞书多维表格中维护正式标签库。
- 工具每次运行前读取最新库。
- AI 输出只能选择已启用标签，除非标记为新增建议。
- 新增建议由人工审核后写入配置库。

最需要优先提供或确认的选择列表：

1. 游戏类型。
2. 细分类型。
3. 游戏题材。
4. 画风。
5. 特色标签。
6. 适合人群。
7. 操作方式。

可以后补的选择列表：

- BGM 类型。
- 新手引导类型。
- 横版/竖版。
- 设备适配等级。
- 自适配等级。
- 广告/变现标签。

## 8. POC 暂不包含

- 不做深度 AI 自动操作。
- 不接小程序和 App。
- 不直接写入真实飞书多维表格。
- 不做完整 30 分钟批量评测。
- 不做 EXE 打包。

## 9. POC 预留能力

- 飞书多维表格数据源接口。
- AI Provider 配置。
- API Key 配置。
- AI 自动操作开关。
- 最大 AI 操作次数。
- 单次操作超时时间。
- 证据文件上传接口。

## 10. POC 验收标准

第一轮端到端验收：

- 使用 1 个 H5 游戏链接跑通。
- 成功创建游戏证据文件夹。
- 成功采集 Page Title、Meta Description、加载时长、截图。
- 成功读取本地模拟标签库。
- 成功输出中文 JSON 和英文 JSON。
- 对无法匹配的字段给出新增建议。

第二轮兼容性验收：

- 使用 5-10 个 H5 游戏链接测试。
- 至少 80% 能成功打开并生成基础报告。
- 至少 60% 能较准确识别游戏类型、题材、画风和操作方式。

## 11. UI 风格方向

主参考：`E:\design-md-brands\design-airtable.md`

选择原因：

- 适合数据工作台、表格、批量任务和配置库。
- 比深色开发者工具更适合长时间运营使用。
- 比强品牌展示风格更利于评测人员快速阅读和复核。

POC UI 原则：

- 后台中文。
- 表格清晰。
- 证据截图和字段结果并排可查看。
- 低置信度字段突出显示。
- 配置库和评测结果分区明确。

## 12. 本地 POC 运行方式

安装依赖：

```bash
npm install
```

只验证本地模拟多维表格和证据目录：

```bash
npm run poc:mock
```

执行真实浏览器采集：

```bash
npm run poc:playwright -- --play-seconds 60
```

生成 AI 请求预览，不调用 Gemini：

```bash
npm run poc:ai -- --dry-run
```

测试 Gemini 连接，不上传截图：

```bash
npm run poc:ai:test
```

调用 Gemini 生成 AI 评测：

```bash
npm run poc:ai
```

如果 Gemini 网络暂时不可用，可以使用本地兜底评测模式继续验证产品链路：

```bash
npm run poc:ai:local
```

生成本地 HTML 报告页：

```bash
npm run poc:report
```

生成飞书多维表格写入预览：

```bash
npm run poc:feishu:preview
```

生成统一标签库导入模板：

```bash
npm run poc:taxonomy:seed
```

从飞书同步标签库：

```bash
npm run poc:taxonomy:sync
```

自动创建飞书标签库表并导入初始选项：

```bash
npm run poc:taxonomy:setup-feishu -- --apply
```

单游戏完整管线：

```bash
npm run poc:pipeline -- --game-id cow-saver --play-seconds 60 --ai local --trace off --write-feishu
```

生成批量任务计划：

```bash
npm run poc:batch:plan
```

预览批量任务执行计划：

```bash
npm run poc:batch:run
```

真正执行批量任务：

```bash
npm run poc:batch:run -- --full-pipeline --execute
```

说明：

- `--play-seconds` 控制每个设备/网络环境进入游戏后的采样时长。
- POC 为了避免下载大体积浏览器，使用 `playwright-core` + 本机 Microsoft Edge。
- 当前 POC 默认采集截图和网络摘要，不默认采集 Playwright trace。trace 文件在部分 H5 游戏里可能非常大，会拖慢批量任务。
- 如需调试单个问题游戏，可加 `--trace minimal` 或 `--trace full`；正式批量建议保持 `--trace off`。
- 完整视频录制放到 V1，届时需要完整 Playwright 浏览器/ffmpeg 组件。
- `poc:pipeline` 带步骤级超时和进程树清理；如果单个游戏卡住，会终止该步骤并记录失败，不会无限拖住整批任务。
- 截图有双通道策略：常规 Playwright 截图失败时，会使用浏览器 CDP 截图接口兜底。
- Slow 4G 通过浏览器调试协议限制当前自动化页面，不会影响电脑本身网络。
- 如果 PowerShell 提示禁止运行 `npm.ps1`，可以用 `npm.cmd run poc:ai`。
- `poc:ai:local` 会读取 `manual_observations.zh.json`，生成本地兜底评测结果，明确标记 `evaluation_source=local_fallback`。
- `poc:report` 会生成 `evidence/<game_id>/report.html`，用于快速查看截图、采集结果和 AI/兜底评测字段。
- `poc:feishu:preview` 会生成 `evidence/<game_id>/feishu_payload_preview.json`，预览后续写入飞书多维表格的一条记录。
- `poc:feishu:write -- --apply` 会按 `Game ID` / `Game URL` 查重，已有记录更新，没有记录才新增。
- `poc:taxonomy:seed` 会生成 `mock_bitable/taxonomy_options_seed.csv`，用于导入飞书标签库表。
- `poc:taxonomy:sync` 会从飞书标签库表读取最新选项；未配置时继续使用本地 CSV。
- `poc:taxonomy:setup-feishu -- --apply` 会自动创建 `Taxonomy Options` 表，导入初始标签库，并把 table_id 写回本地配置。
- `poc:pipeline` 会串起采集、AI、Payload、字段检查、飞书 upsert、报告和工作台；如果证据不完整，会标记为 `success_with_review`。
- `poc:ai:test` 会生成 `config/gemini_connection_check.json`，用于判断 Key、模型和当前网络是否可用。
- `poc:batch:plan` 会生成 `batch/manifest.json` 和 `batch/run_plan.md`，用于后续批量链接运行和状态跟踪。
- `poc:batch:run` 默认只生成 dry-run，不会真的打开浏览器；加 `-- --full-pipeline --execute` 后才会执行完整管线。

## 12.1 Gemini API Key 填写方式

项目根目录已经有 `.env`，只需要填一行：

```text
GEMINI_API_KEY=你的 Gemini API Key
```

默认模型：

```text
GEMINI_MODEL=gemini-2.5-flash-lite
```

如果当前网络不能直接访问 Gemini，可以配置代理：

```text
GEMINI_PROXY=http://127.0.0.1:7890
```

也可以使用系统代理变量：

```text
HTTPS_PROXY=http://127.0.0.1:7890
```

连接测试：

```bash
npm run poc:ai:test
```

低成本 Gemini 请求预览，只准备 1 张截图，不真正调用 API：

```bash
npm run poc:ai -- --game-id pixel-match --dry-run --mode low --max-images 1
```

低成本正式调用，只发送 1 张截图：

```bash
npm run poc:ai -- --game-id pixel-match --mode low --max-images 1
```

可选更高精度模型：

```text
GEMINI_MODEL=gemini-2.5-pro
```

建议：

- POC 默认使用 `gemini-2.5-flash-lite`，速度、稳定性和成本更适合批量评测。
- 复杂游戏、低置信度复核、需要更强推理时再切到 `gemini-2.5-flash` 或 `gemini-2.5-pro`。
- 如果 `gemini-2.5-flash` 返回 503 high demand，可以先用 `gemini-2.5-flash-lite` 做低成本验证。
- 不要把 API Key 发到聊天里，只在本地 `.env` 文件里填写。
- `.env` 已加入 `.gitignore`，避免误提交真实密钥。
- 如果生成 `ai_eval_error.json` 且错误是连接超时，通常是当前网络无法访问 Gemini API，需要切换网络、开启代理/VPN，或改用当前网络可访问的多模态模型供应商。

## 13. 已跑通的 POC 采集项

首个样本 `cow-saver` 已完成一次真实采集，输出位置：

```text
evidence/cow-saver/
  screenshots/
  network/
  traces/
  video/
  report.zh.json
  report.en.json
```

当前已跑通：

- 桌面正常网络截图。
- 手机竖屏正常网络截图。
- 手机横屏正常网络截图。
- 桌面 Slow 4G 截图。
- Page Title、Meta、Keywords 抓取。
- 资源体积估算。
- 失败请求数量统计。
- Play now 规则点击。
- 常见弹窗/广告关闭规则预留。
- 中文后台报告和英文导出报告。
