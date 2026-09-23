export const STEPS = [
  { id: 'project', prompt: '00-project/创建项目.md', kind: 'project' },
  { id: 'authorization', prompt: '00-project/建站授权准备.md', kind: 'authorization', remote: true },
  { id: 'reference', prompt: '01-reference/页面爬取.md', kind: 'reference' },
  { id: 'catalog_extract', prompt: '03-catalog/爬取商品SKU.md', kind: 'catalog_extract' },
  { id: 'catalog_clean', prompt: '03-catalog/商品CSV数据清洗.md', kind: 'catalog_clean' },
  { id: 'catalog_import', prompt: '03-catalog/导入商品.md', kind: 'catalog_import', remote: true },
  { id: 'collections', prompt: '03-catalog/创建分类.md', kind: 'collections', remote: true },
  { id: 'content', prompt: '02-theme/pages/页面补齐.md', kind: 'content', remote: true, when: 'content' },
  { id: 'theme', prompt: '02-theme/开始复刻.md', kind: 'theme', remote: true },
  { id: 'rough', prompt: '02-theme/页面粗调.md', kind: 'visual', remote: true },
  { id: 'fine', prompt: '02-theme/像素级精修.md', kind: 'visual', remote: true },
  { id: 'page_audit', kind: 'page_audit' },
  { id: 'home', prompt: '02-theme/pages/首页.md', kind: 'visual', remote: true, when: 'home' },
  { id: 'product', prompt: '02-theme/pages/商品详情页.md', kind: 'visual', remote: true, when: 'product' },
  { id: 'footer', prompt: '02-theme/pages/底栏.md', kind: 'visual', remote: true, when: 'footer' },
  { id: 'discount', prompt: '04-customization/打折.md', kind: 'discount', remote: true },
  { id: 'remove_features', prompt: '04-customization/功能削减.md', kind: 'visual', remote: true },
  { id: 'cookie', prompt: '04-customization/Cookie.md', kind: 'visual', remote: true },
  { id: 'sticky', prompt: '04-customization/粘性顶栏.md', kind: 'visual', remote: true, when: 'sticky' },
  { id: 'qa', prompt: '05-qa/交付评估.md', kind: 'qa', remote: true },
  { id: 'launch_preflight', kind: 'launch_preflight', remote: true },
  { id: 'publish', kind: 'publish', remote: true },
  { id: 'open_store', prompt: '05-qa/设置商家地址并开放店铺.md', kind: 'open_store', remote: true },
  { id: 'public_qa', kind: 'public_qa', remote: true },
];

export const THEME_STEPS = [
  { id: 'reference', prompt: '01-reference/页面爬取.md', kind: 'reference' },
  { id: 'theme_local', prompt: 'prompts/theme-only/theme.md', kind: 'theme_local', localPrompt: true },
  { id: 'local_qa', prompt: 'prompts/theme-only/local-qa.md', kind: 'local_qa', localPrompt: true },
];

export function stepsForMode(mode) {
  if (mode === 'theme-only') return THEME_STEPS;
  if (mode === 'full-store') return STEPS;
  throw new Error(`Unsupported mode: ${mode}`);
}

export function shouldRun(step, facts = {}) {
  if (step.when === 'content') return Array.isArray(facts.contentPaths) && facts.contentPaths.length > 0;
  if (step.when === 'home') return facts.needsHomeFix === true;
  if (step.when === 'product') return facts.needsProductFix === true;
  if (step.when === 'footer') return facts.needsFooterFix === true;
  if (step.when === 'sticky') return facts.needsStickyHeader === true;
  return true;
}

export const FACT_FIELDS = {
  sourceBrand: '', draftThemeId: '', csvPath: '', contentPaths: [],
  needsHomeFix: false, needsProductFix: false, needsFooterFix: false,
  needsStickyHeader: false, blockingIssues: [], publicPaths: [],
};
