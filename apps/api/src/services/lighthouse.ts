// ============================================================
// SimpleBuild Pro — Lighthouse Scoring Service
// Runs Lighthouse audits on deployed sites via PageSpeed API
// Falls back to HTML-based static analysis when API unavailable
// ============================================================

import { logger } from './logger';

export interface LighthouseScores {
  performance: number;      // 0-100
  accessibility: number;    // 0-100
  bestPractices: number;    // 0-100
  seo: number;              // 0-100
  overall: number;          // Weighted average
}

export interface LighthouseAuditResult {
  scores: LighthouseScores;
  diagnostics: LighthouseDiagnostic[];
  fetchedAt: string;
  source: 'pagespeed-api' | 'static-analysis';
}

export interface LighthouseDiagnostic {
  id: string;
  title: string;
  description: string;
  score: number | null;
  category: 'performance' | 'accessibility' | 'best-practices' | 'seo';
}

const PAGESPEED_API_KEY = process.env.PAGESPEED_API_KEY || '';
const PAGESPEED_API_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

// ─── Run Lighthouse via PageSpeed Insights API ───────────────
export async function runLighthouseAudit(url: string): Promise<LighthouseAuditResult> {
  // Try PageSpeed API first
  if (PAGESPEED_API_KEY) {
    try {
      return await runPageSpeedAudit(url);
    } catch (err) {
      logger.warn('PageSpeed API failed, falling back to static analysis', { error: String(err) });
    }
  }

  // Fallback to static analysis
  return runStaticAnalysis(url);
}

// ─── PageSpeed Insights API ──────────────────────────────────
async function runPageSpeedAudit(url: string): Promise<LighthouseAuditResult> {
  const categories = ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'];
  const params = new URLSearchParams({
    url,
    key: PAGESPEED_API_KEY,
    strategy: 'MOBILE',
  });
  for (const cat of categories) {
    params.append('category', cat);
  }

  const res = await fetch(`${PAGESPEED_API_URL}?${params}`, {
    signal: AbortSignal.timeout(60000), // 60s timeout
  });

  if (!res.ok) {
    throw new Error(`PageSpeed API returned ${res.status}`);
  }

  const data = await res.json() as any;
  const lhr = data.lighthouseResult;

  if (!lhr?.categories) {
    throw new Error('Invalid PageSpeed API response');
  }

  const scores: LighthouseScores = {
    performance: Math.round((lhr.categories.performance?.score || 0) * 100),
    accessibility: Math.round((lhr.categories.accessibility?.score || 0) * 100),
    bestPractices: Math.round((lhr.categories['best-practices']?.score || 0) * 100),
    seo: Math.round((lhr.categories.seo?.score || 0) * 100),
    overall: 0,
  };

  scores.overall = Math.round(
    (scores.performance * 0.35 +
     scores.accessibility * 0.25 +
     scores.bestPractices * 0.20 +
     scores.seo * 0.20)
  );

  // Extract key diagnostics
  const diagnostics: LighthouseDiagnostic[] = [];
  const audits = lhr.audits || {};

  const keyAudits = [
    'first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time',
    'cumulative-layout-shift', 'speed-index',
    'color-contrast', 'image-alt', 'label', 'link-name',
    'meta-description', 'document-title', 'viewport',
    'errors-in-console', 'is-crawlable',
  ];

  for (const auditId of keyAudits) {
    const audit = audits[auditId];
    if (audit) {
      diagnostics.push({
        id: auditId,
        title: audit.title || auditId,
        description: audit.description || '',
        score: audit.score,
        category: getCategoryForAudit(auditId),
      });
    }
  }

  logger.info('Lighthouse audit completed via PageSpeed API', {
    url,
    scores,
  });

  return {
    scores,
    diagnostics,
    fetchedAt: new Date().toISOString(),
    source: 'pagespeed-api',
  };
}

// ─── Static Analysis Fallback ────────────────────────────────
async function runStaticAnalysis(url: string): Promise<LighthouseAuditResult> {
  let html = '';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    html = await res.text();
  } catch {
    // If we can't fetch, return zero scores
    return {
      scores: { performance: 0, accessibility: 0, bestPractices: 0, seo: 0, overall: 0 },
      diagnostics: [{ id: 'fetch-failed', title: 'Could not fetch page', description: `Failed to load ${url}`, score: 0, category: 'performance' }],
      fetchedAt: new Date().toISOString(),
      source: 'static-analysis',
    };
  }

  const diagnostics: LighthouseDiagnostic[] = [];
  let perfScore = 70;
  let a11yScore = 70;
  let bpScore = 70;
  let seoScore = 70;

  // Performance checks
  if (html.length > 500_000) { perfScore -= 20; diagnostics.push({ id: 'large-html', title: 'Large HTML document', description: `HTML is ${(html.length / 1024).toFixed(0)}KB`, score: 0, category: 'performance' }); }
  if (!html.includes('loading="lazy"')) { perfScore -= 5; }
  if (html.includes('<script') && !html.includes('defer') && !html.includes('async')) { perfScore -= 10; }

  // Accessibility checks
  const hasLang = /<html[^>]+lang=/i.test(html);
  if (!hasLang) { a11yScore -= 15; diagnostics.push({ id: 'html-lang', title: 'Missing lang attribute', description: '<html> should have a lang attribute', score: 0, category: 'accessibility' }); }

  const imgCount = (html.match(/<img /gi) || []).length;
  const altCount = (html.match(/<img [^>]*alt=/gi) || []).length;
  if (imgCount > 0 && altCount < imgCount) { a11yScore -= 15; diagnostics.push({ id: 'image-alt', title: 'Images missing alt text', description: `${imgCount - altCount} of ${imgCount} images missing alt`, score: 0, category: 'accessibility' }); }

  // Best practices checks
  if (!html.includes('<!DOCTYPE html') && !html.includes('<!doctype html')) { bpScore -= 10; }
  if (html.includes('http://') && !html.includes('localhost')) { bpScore -= 10; diagnostics.push({ id: 'mixed-content', title: 'Potential mixed content', description: 'Found http:// URLs (should use https://)', score: 0, category: 'best-practices' }); }

  // SEO checks
  if (!/<meta[^>]+name=["']description["']/i.test(html)) { seoScore -= 20; diagnostics.push({ id: 'meta-description', title: 'Missing meta description', description: 'Add a meta description for better SEO', score: 0, category: 'seo' }); }
  if (!/<title>/i.test(html)) { seoScore -= 20; diagnostics.push({ id: 'title', title: 'Missing page title', description: 'Add a <title> tag', score: 0, category: 'seo' }); }
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) { seoScore -= 15; diagnostics.push({ id: 'viewport', title: 'Missing viewport meta', description: 'Add viewport meta for mobile', score: 0, category: 'seo' }); }
  if (!/<h1/i.test(html)) { seoScore -= 10; }

  const scores: LighthouseScores = {
    performance: Math.max(0, Math.min(100, perfScore)),
    accessibility: Math.max(0, Math.min(100, a11yScore)),
    bestPractices: Math.max(0, Math.min(100, bpScore)),
    seo: Math.max(0, Math.min(100, seoScore)),
    overall: 0,
  };

  scores.overall = Math.round(
    scores.performance * 0.35 +
    scores.accessibility * 0.25 +
    scores.bestPractices * 0.20 +
    scores.seo * 0.20
  );

  logger.info('Lighthouse audit completed via static analysis', { url, scores });

  return {
    scores,
    diagnostics,
    fetchedAt: new Date().toISOString(),
    source: 'static-analysis',
  };
}

// ─── Helper ──────────────────────────────────────────────────
function getCategoryForAudit(auditId: string): LighthouseDiagnostic['category'] {
  const perfAudits = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index'];
  const a11yAudits = ['color-contrast', 'image-alt', 'label', 'link-name'];
  const seoAudits = ['meta-description', 'document-title', 'viewport', 'is-crawlable'];
  if (perfAudits.includes(auditId)) return 'performance';
  if (a11yAudits.includes(auditId)) return 'accessibility';
  if (seoAudits.includes(auditId)) return 'seo';
  return 'best-practices';
}

// ─── Run analysis on built HTML files (pre-deploy) ───────────
export function analyzeHtmlFiles(files: { path: string; content: string }[]): LighthouseScores {
  let totalPerf = 0, totalA11y = 0, totalBp = 0, totalSeo = 0;
  let htmlFileCount = 0;

  for (const file of files) {
    if (!file.path.endsWith('.html') && !file.path.endsWith('.htm')) continue;
    htmlFileCount++;
    const html = file.content;

    let perf = 80, a11y = 80, bp = 80, seo = 80;

    // Performance
    if (html.length > 200_000) perf -= 15;
    if (html.includes('<script') && !html.includes('defer') && !html.includes('async')) perf -= 10;

    // Accessibility
    if (!/<html[^>]+lang=/i.test(html)) a11y -= 15;
    const imgs = (html.match(/<img /gi) || []).length;
    const alts = (html.match(/<img [^>]*alt=/gi) || []).length;
    if (imgs > 0 && alts < imgs) a11y -= Math.min(20, (imgs - alts) * 5);

    // Best practices
    if (!html.includes('<!DOCTYPE html') && !html.includes('<!doctype html')) bp -= 10;
    if (!html.includes('<meta charset')) bp -= 5;

    // SEO
    if (!/<title>/i.test(html)) seo -= 20;
    if (!/<meta[^>]+name=["']description["']/i.test(html)) seo -= 15;
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) seo -= 15;

    totalPerf += Math.max(0, perf);
    totalA11y += Math.max(0, a11y);
    totalBp += Math.max(0, bp);
    totalSeo += Math.max(0, seo);
  }

  if (htmlFileCount === 0) {
    return { performance: 0, accessibility: 0, bestPractices: 0, seo: 0, overall: 0 };
  }

  const scores: LighthouseScores = {
    performance: Math.round(totalPerf / htmlFileCount),
    accessibility: Math.round(totalA11y / htmlFileCount),
    bestPractices: Math.round(totalBp / htmlFileCount),
    seo: Math.round(totalSeo / htmlFileCount),
    overall: 0,
  };

  scores.overall = Math.round(
    scores.performance * 0.35 +
    scores.accessibility * 0.25 +
    scores.bestPractices * 0.20 +
    scores.seo * 0.20
  );

  return scores;
}
