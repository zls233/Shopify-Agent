# Shopify Agent

输入一个原站 URL，让 Codex 按 [Shopify-Prompts](../Shopify-Prompts/README.md) 的步骤建立专用 Shopify 店铺。这里仅有一个 Node.js CLI 和少量状态文件；实际采集、主题实现、商品写入及浏览器检查仍由各步骤的 Codex 会话完成。

## 准备

- Node.js 20+、Codex CLI、Shopify CLI、Playwright 所需浏览器，以及已登录目标店铺 Admin 的 SunBrowser。
- 一个只供本项目使用、商品数为零且商家地址完整的 Shopify 店铺。准备 Theme Access token，并用 Shopify CLI 授权具有建站权限的 Admin App。Theme Access 与 Admin 授权是两条独立通道。
- 将 `.env.example` 复制为 `.env.local`，填入 `SHOPIFY_CLI_THEME_TOKEN`；凭据不会写入项目报告。Codex CLI 可复用本机已有登录。
- 运行 `setup` 代表允许这个专用店铺在完整 QA 通过后自动发布主题并开放访问。当前实现不处理付款、协议确认、登录、2FA 或 CAPTCHA；遇到这些步骤会暂停。

```bash
npm run setup -- --store your-store.myshopify.com \
  --project "/absolute/path/to/new-project" \
  --prompts "/absolute/path/to/Shopify-Prompts" \
  --template "/absolute/path/to/Shopify-Template"

npm run run -- https://theordinary.com/en-us
npm run status
npm run resume
```

`--project`、`--prompts`、`--template` 可省略；默认分别位于本仓库的 `projects/<store>`、相邻的 `Shopify-Prompts` 和相邻的 `Shopify-Template`。目标项目目录必须为空。`setup` 只读核对店铺、Admin App、Theme Access、商家地址及 SunBrowser 会话；`run` 才开始建立项目和远端资源。项目及原站在首次运行后固定，换店铺或换原站应使用新的 Agent 项目。

## 执行与恢复

流程依次运行项目初始化、授权、原站参考、商品抓取和清洗、导入、分类和内容页面、主题复刻、页面精调、定制、QA、上线检查、主题发布、开放访问及公开站点检查。内容页面、页面专项修复和粘性顶栏依据采集证据执行；全店四折、功能削减、Cookie 固定执行，独立 LOGO Prompt 不执行。

每步使用 `codex exec --json --output-schema`，将会话 ID、Prompt 哈希、结果和错误保存在忽略的 `.shopify-agent/`。生成的 Shopify 项目拥有独立 Git 仓库。失败时最多自动修复三轮；认证、权限、原站限流和其他外部阻塞会暂停。解决问题后运行 `npm run resume`，已验收步骤不会重做，远端写入前会再次核对店铺与 App 身份。

自动上线要求 Draft Theme QA、真实商品和价格、Online Store 发布、桌面/移动端及购买路径全部通过。发布后做无登录态公开检查；若失败，尝试恢复先前 Live Theme，并在原本有密码保护时恢复 Private Mode。恢复失败会标记为需要人工核对，不会继续执行。

当前用户提供的 `https://theordinary.com/us` 在 2026-09-23 的只读检查中返回 404，同域名 `https://theordinary.com/en-us` 返回 200。采集阶段遇到失效入口时会核实同域名的实际路径并记录，而不会把 404 当作首页。

## 验证

```bash
npm run check
npm test
```

测试用模拟 Codex 与 Shopify 响应覆盖步骤顺序、条件跳过、断点续跑、数据检查和上线门槛。真实端到端运行仍需专用测试店铺。
