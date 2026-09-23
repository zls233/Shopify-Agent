# Shopify Agent

输入一个原站 URL，让 CLI 按步骤调用 Codex。支持两种范围：`theme-only` 在没有店铺时采集参考并制作本地主题；`full-store` 按 [Shopify-Prompts](../Shopify-Prompts/README.md) 的步骤建立专用 Shopify 店铺。实际采集、主题实现、商品写入及浏览器检查仍由各步骤的 Codex 会话完成。

## 无店铺主题模式

```bash
npm run setup -- --mode theme-only --project "/absolute/path/to/new-project"
npm run plan
npm run run -- https://theordinary.com/en-us
npm run status -- --verbose
```

目标目录应为空。系统先运行 `Shopify-Prompts/01-reference/页面爬取.md`，然后依次运行本仓库的 `prompts/theme-only/theme.md` 与 `prompts/theme-only/local-qa.md`。每步都通过 `codex exec` 执行并保存证据；本模式不要求店铺或 Shopify 凭据，也不会调用 Admin、上传或发布主题。完成状态是 `completed_local`：Theme Check、主题 JSON 和 JavaScript 可以在本地检查，Shopify 实际渲染、真实商品、购物袋和视觉预览仍需店铺验证。

接管已有主题时，不复制模板或覆盖已有文件：

```bash
npm run setup -- --mode theme-only \
  --project "/absolute/path/to/existing-project" --adopt-existing
npm run run -- --from local_qa https://theordinary.com/en-us
```

`--from theme_local` 需要完整的 `manifest.json` 参考包；对于旧项目，也接受指向同一原站、写明商品和分类页并链接真实桌面/手机截图的参考摘要。`--from local_qa` 需要主题入口、首页模板及指向同一原站的参考摘要。此前步骤被记为 `external`，表示产物来自系统外部，**不表示这些提示词由 Shopify Agent 执行过**。若缺少前置证据，从 `reference` 开始。已有运行状态只能从前置步骤均已完成或明确标记为外部成果的未完成步骤继续；常规中断用 `npm run resume`。

一个 Agent 配置目录只绑定一个项目。需要另一项目时使用另一检出目录，或为每个项目设置不同的 `SHOPIFY_AGENT_HOME`；不要删除已有状态来绕过绑定。

## 完整建店模式准备

- Node.js 20+、Codex CLI、Shopify CLI、Playwright 所需浏览器，以及已登录目标店铺 Admin 的 SunBrowser。
- 一个只供本项目使用、商品数为零且商家地址完整的 Shopify 店铺。准备 Theme Access token，并用 Shopify CLI 授权具有建站权限的 Admin App。Theme Access 与 Admin 授权是两条独立通道。
- 将 `.env.example` 复制为 `.env.local`，填入 `SHOPIFY_CLI_THEME_TOKEN`；凭据不会写入项目报告。Codex CLI 可复用本机已有登录。
- 运行 `setup` 代表允许这个专用店铺在完整 QA 通过后自动发布主题并开放访问。当前实现不处理付款、协议确认、登录、2FA 或 CAPTCHA；遇到这些步骤会暂停。

```bash
npm run setup -- --mode full-store --store your-store.myshopify.com \
  --project "/absolute/path/to/new-project" \
  --prompts "/absolute/path/to/Shopify-Prompts" \
  --template "/absolute/path/to/Shopify-Template"

npm run run -- https://theordinary.com/en-us
npm run plan
npm run status
npm run resume
```

`full-store` 是默认模式。`--project`、`--prompts`、`--template` 可省略；默认分别位于本仓库的 `projects/<store>`、相邻的 `Shopify-Prompts` 和相邻的 `Shopify-Template`。目标项目目录必须为空。`setup` 只读核对店铺、Admin App、Theme Access、商家地址及 SunBrowser 会话；`run` 才开始建立项目和远端资源。项目及原站在首次运行后固定，换店铺或换原站应使用新的 Agent 项目。

## 执行与恢复

流程依次运行项目初始化、授权、原站参考、商品抓取和清洗、导入、分类和内容页面、主题复刻、页面精调、定制、QA、上线检查、主题发布、开放访问及公开站点检查。内容页面、页面专项修复和粘性顶栏依据采集证据执行；全店四折、功能削减、Cookie 固定执行，独立 LOGO Prompt 不执行。

每步使用 `codex exec --json --output-schema`，将会话 ID、Prompt 哈希、结果和错误保存在忽略的 `.shopify-agent/`。生成的 Shopify 项目拥有独立 Git 仓库。失败时最多自动修复三轮；认证、权限、原站限流和其他外部阻塞会暂停。解决问题后运行 `npm run resume`，已验收步骤不会重做，远端写入前会再次核对店铺与 App 身份。

`npm run plan` 显示当前模式的步骤、提示词路径和远端标记；`npm run status -- --verbose` 额外显示每步的会话 ID、提示词哈希、结果和事件路径。`run -- --from <step> <URL>` 只允许从已有可靠前置状态开始；完整建店模式不能在新项目中跳过前面的远端步骤。

自动上线要求 Draft Theme QA、真实商品和价格、Online Store 发布、桌面/移动端及购买路径全部通过。发布后做无登录态公开检查；若失败，尝试恢复先前 Live Theme，并在原本有密码保护时恢复 Private Mode。恢复失败会标记为需要人工核对，不会继续执行。

当前用户提供的 `https://theordinary.com/us` 在 2026-09-23 的只读检查中返回 404，同域名 `https://theordinary.com/en-us` 返回 200。采集阶段遇到失效入口时会核实同域名的实际路径并记录，而不会把 404 当作首页。

## 可复制的使用 Prompt

以下文字可以直接发给 Codex。先替换尖括号中的原站、项目路径和店铺域名；一个 Agent 配置目录只绑定一个项目，切换项目时应设置独立的 `SHOPIFY_AGENT_HOME`。

### 1. 从零制作本地主题（无需店铺）

```text
请使用当前 Shopify Agent 仓库的 CLI，参考 <原站 URL>，在空目录 <新项目绝对路径> 制作 Shopify 主题。选择 theme-only 模式，先执行 setup 和 plan，再按系统步骤运行提示词；结束后查看 verbose status，并列出每步状态、实际产物和验证结果。不要操作 Shopify 店铺；本地完成后，把仍需店铺预览验证的项目单独列出。
```

### 2. 接管已有主题，从主题制作步骤继续

```text
请使用 Shopify Agent 接管 <已有项目绝对路径>，参考站是 <原站 URL>。先检查现有文件、Git 状态，以及参考包或参考摘要与真实桌面/手机截图；保留已有改动。使用 theme-only 和 --adopt-existing，满足前置条件时从 theme_local 开始运行并检查状态。如果参考证据不足，就从 reference 步骤开始。报告中将接管前的成果标为 external，不要说成系统运行过此前提示词。
```

### 3. 只从本地 QA 步骤开始

```text
<已有项目绝对路径> 已有主题入口、首页模板，以及对应 <原站 URL> 的参考摘要。请先核对这些前置产物，再用 Shopify Agent 的 theme-only、--adopt-existing 和 --from local_qa 运行本地 QA。检查 Theme Check、主题 JSON 和 JavaScript，并用 verbose status 给出步骤证据；如前置产物不满足要求，请从缺失的步骤开始，不要强行跳过。
```

### 4. 恢复已暂停的运行

```text
请检查当前 Shopify Agent 绑定项目的 verbose status 和最近的错误，确认暂停原因及可继续的步骤。阻塞条件解决后运行 npm run resume，保留原有状态和已验收产物；结束后报告本次实际运行的步骤、结果和仍未解决的问题。不要重新 setup 或将已有成果重复计为本次执行。
```

### 5. 完整建店并在验收通过后上线

```text
请使用 Shopify Agent 的 full-store 模式，以 <原站 URL> 为参考，为专用空店铺 <店铺域名.myshopify.com> 在空目录 <新项目绝对路径> 建站。先核对店铺身份、Admin App 授权、Theme Access、商家地址和已登录的 SunBrowser，执行 setup 与 plan 后按顺序运行提示词，并逐步核对产物和状态。我授权在全部 QA 门槛通过后自动发布主题并开放访问；如果认证、权限或人工验证阻塞，请暂停并报告具体原因，不要声称已上线。
```

## 验证

```bash
npm run check
npm test
```

测试用模拟 Codex 与 Shopify 响应覆盖步骤顺序、条件跳过、断点续跑、无店铺边界、既有项目接管和上线门槛；还通过假 Codex 可执行文件验证 CLI 子进程调用与状态持久化。真实店铺端到端运行仍需专用测试店铺。
