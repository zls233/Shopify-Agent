# 无店铺主题实现

目标原站：`{{TARGET_SITE_URL}}`。项目：`{{PROJECT_PATH}}`。

先读取项目中的 `site-reference-summary.md`、桌面与手机截图；若有 `manifest.json` 和 `references/`，也要读取。检查目标站的代表性首页、商品页和分类页。以真实 DOM、图片、布局及交互证据为基准，在 `theme/` 中实现可编辑的 Shopify Liquid 模板和 section。商品、分类、变体、价格、筛选、排序、购物袋必须使用 Shopify 原生对象和路由；无商品数据时只能用明确标注的示例内容，不得让示例按钮假装完成加购。

检查导航和页脚的每个目标。没有对应 Shopify 内容资源时，记录待绑定路径；不要以硬编码的 404、虚构价格、运费、退货或商家承诺代替真实数据。保留项目现有改动；接管已有主题时做增量修改，不重新初始化或覆盖项目。

运行 `shopify theme check --path theme`、相关 JavaScript 语法和 JSON 解析检查，修复发现的问题。将已实现的模板、原站证据、仍需店铺验证的交互和缺失内容写入 `agent-evidence/theme_local.md`。本步骤没有店铺，不运行 Theme Dev、push、Admin 写入或发布。不要宣称已验证 Shopify 实际渲染、桌面/手机预览或购买路径。
