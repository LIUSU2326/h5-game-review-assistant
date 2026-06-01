# v1.6 AI 自动试玩增强

v1.6 的第一步不是直接开启高消耗的多模态 AI 玩家，而是把“自动试玩能力”拆成可理解、可验证、可渐进升级的策略层。

## v1.6.0-alpha.1

新增内容：

- 新增 `adaptive_probe` 自动试玩策略。
- 配置中心新增“AI Player”策略面板，可以看到默认策略、动作记录、多模态决策是否开启、每个策略的适用场景。
- `ai_probe_alpha` 运行档位用于单款或小批量验证新策略。
- 自动试玩摘要可一键复制，方便记录当前策略和 API 消耗说明。

## 策略说明

| 策略 | 用途 | 是否消耗额外 AI API |
|---|---|---|
| `passive` | 只等待和采集，适合加载、广告、弱网页面排查 | 否 |
| `legacy_center_tap` | 固定区域安全点击，兼容性高 | 否 |
| `guided_probe` | 识别 Play/Start/Continue 等按钮，并进行点击、拖拽、方向键探测 | 否 |
| `adaptive_probe` | 增加弹窗扫描、动作意图标记和更完整动作日志，为后续多模态 AI 玩家预留 | 当前否 |

## API 消耗

当前自动试玩仍由 Playwright 在浏览器里执行启发式动作，不会逐帧调用 Gemini。Gemini 主要消耗仍来自“AI 评测字段生成”步骤。

后续如果开启真正的多模态 AI 玩家，会作为独立开关接入，并在配置中心明确显示预计调用方式和消耗风险。

## 本地验证

2026-06-01 已用 Cow Saver 跑通 `adaptive_probe` 极短烟测：

```powershell
node tools\run_playwright_poc.mjs --game-id cow-saver --play-seconds 2 --play-strategy adaptive_probe
```

结果：4 个设备/网络档位均完成采集，每个档位生成自动试玩动作记录。
