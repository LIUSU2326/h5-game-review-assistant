# H5 游戏评测助手

本项目是一个本地桌面工具，用于批量评测 H5 网页小游戏：自动打开游戏链接、采集多设备截图和本地视频证据、调用 Gemini 生成评测内容，并可写入飞书多维表格。

当前稳定下载版为 v1.6.0；源码已进入 v1.8.3-rc.3 候选阶段，重点做真实体验测试前的反馈收口。

## 功能概览

- 导入 H5 游戏链接并维护游戏库。
- 使用 Playwright/Edge 采集桌面、移动竖屏、移动横屏、Slow 4G 弱网页面证据。
- 每款游戏本地保存独立证据文件夹，包含截图、视频、报告和运行记录。
- 使用 Gemini 生成游戏类型、题材、画风、玩法、人群、英文介绍、How To Play、FAQ 等评测字段。
- 支持从飞书表格同步标签库，并将评测结果写回飞书多维表格。
- 提供本地桌面界面和 Windows portable exe 打包配置。

## 直接下载 Windows 版

如果只是想稳定试用工具，可以直接下载 portable 正式版：

- [H5游戏评测助手-v1.6.0.zip](downloads/H5游戏评测助手-v1.6.0.zip)

当前 v1.8.3-rc.3 是源码开发线，暂不提供新的稳定下载包；需要体验时可在本地运行或后续统一打包。

如果想保留旧版基线，也可以下载：

- [H5游戏评测助手-v1.3.0.zip](downloads/H5游戏评测助手-v1.3.0.zip)

下载后解压，运行里面的 `H5游戏评测助手.exe`。首次使用仍需要在工具里填写 Gemini API Key 和飞书多维表格配置。

## 本地运行

要求：

- Windows 10/11
- Node.js 20+
- Microsoft Edge

安装依赖：

```powershell
npm install
```

启动本地 Web 工作台：

```powershell
npm run app
```

启动桌面壳：

```powershell
npm run desktop
```

打包 Windows portable exe：

```powershell
npm run dist:win
```

该命令会把 Electron 打包临时目录和下载缓存放在项目内的 `.build-temp/`、`.build-cache/`，避免反复打包占满 C 盘。请优先使用这个命令，不要直接运行裸 `electron-builder`。

## 配置

复制示例配置后填写自己的密钥：

```powershell
Copy-Item .env.example .env
Copy-Item config\feishu.local.template.json config\feishu.local.json
```

需要填写：

- `.env`：`GEMINI_API_KEY`
- `config/feishu.local.json`：飞书 App ID、App Secret、多维表格 app_token/table_id

不要提交 `.env`、`config/feishu.local.json`、截图/视频证据、运行日志或打包产物。

## 快速检查

```powershell
npm run app:check
```

该命令会检查 Gemini、飞书配置、飞书字段和标签库同步状态。

## 重要目录

- `app/`：桌面工具前端界面。
- `desktop/`：Electron 桌面壳。
- `tools/`：采集、AI 评测、飞书写入、批量运行脚本。
- `mock_bitable/`：本地字段映射和标签库种子。
- `samples/`：示例游戏列表。
- `config/`：配置模板和运行档位。
- `docs/`：使用说明和飞书接入指南。

## 文档

- `docs/首次启动说明.md`
- `docs/下载与试用说明.md`
- `docs/V1_6正式版说明.md`
- `docs/V1_7_BATCH_PRODUCTION.md`
- `docs/V1_8_FIELD_TABLE_TAXONOMY.md`
- `docs/V1_6_RC1试用分发包.md`
- `docs/飞书接入用户操作指南.md`
- `docs/本地工具UI与EXE打包说明.md`
- `docs/VERSION_ROADMAP.md`

## 安全说明

本项目默认只在本地保存密钥和证据文件。发布源码时请确认没有上传：

- Gemini API Key
- 飞书 App Secret
- `.env`
- `config/feishu.local.json`
- `evidence/`
- `outputs/`
- `dist/`
- `release/`
