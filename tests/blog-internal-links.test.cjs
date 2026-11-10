// Run with: node --test tests/blog-internal-links.test.cjs
// The publication date and store URLs below were checked against HEAD
// 41ad2ff972e6cb845c8fbb19b79102930e6b0d56 before adding contextual links.
// Keeping that small baseline here makes the tests usable after commit or without Git.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const origin = 'https://pricematchparadise.com';
const originalPublicationDate = '2026-09-22';
const originalStoreLinks = [
  'https://apps.apple.com/us/app/price-match-paradise/id6758967914',
  'https://play.google.com/store/apps/details?id=com.ihr.mybarcodeapp'
];
const appSlugs = [
  'scan-barcode-compare-prices', 'barcode-scanner-apps', 'barcode-lookup',
  'find-best-deals', 'online-vs-in-store-prices', 'price-matching-electronics'
];
const contractorSlugs = [
  'home-depot-lowes-price-match', 'price-matching-guide', 'how-to-ask-for-a-price-match',
  'price-match-denied', 'is-buying-in-bulk-worth-it', 'check-receipt-for-overcharges'
];
const pages = [...appSlugs, ...contractorSlugs].map(slug => ({
  slug,
  intent: appSlugs.includes(slug) ? 'app' : 'contractor',
  html: fs.readFileSync(path.join(root, 'blog', slug, 'index.html'), 'utf8')
}));
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');

function attributes(raw) {
  const result = {};
  for (const match of raw.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1].toLowerCase()] = decode(match[2] ?? match[3]);
  }
  return result;
}

function decode(text) {
  return text.replace(/&#(?:x([\da-f]+)|(\d+));/gi, (_, hex, dec) => String.fromCodePoint(parseInt(hex || dec, hex ? 16 : 10)))
    .replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ');
}

function plain(text) {
  return decode(text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function prose(html) {
  const articles = Array.from(html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi));
  const article = articles.find(match => (attributes(match[1]).class || '').split(/\s+/).includes('prose'));
  assert.ok(article, 'Expected a semantic article.prose');
  return article[2];
}

// Track ancestry instead of counting every /download.html in the template.
// Navigation, conversion buttons, sources, author and related-content boxes
// do not satisfy the requirement for a contextual link in the article text.
function contextualAnchors(html) {
  const body = prose(html);
  const stack = [];
  const anchors = [];
  const excludedClasses = new Set(['cta-inline', 'cta-final', 'related', 'author', 'sources', 'app-card', 'sidebar']);
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const match of body.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b[^>]*>/gi)) {
    if (match[0].startsWith('<!--')) continue;
    const name = match[1].toLowerCase();
    if (match[0].startsWith('</')) {
      const index = stack.map(item => item.name).lastIndexOf(name);
      if (index >= 0) {
        const entry = stack[index];
        if (entry.anchor) anchors.push({ ...entry.anchor, text: plain(body.slice(entry.start, match.index)) });
        stack.splice(index);
      }
      continue;
    }
    const attrs = attributes(match[0]);
    const classes = (attrs.class || '').split(/\s+/);
    const excluded = stack.some(item => item.excluded)
      || ['nav', 'aside', 'footer', 'header', 'script', 'style'].includes(name)
      || classes.some(value => excludedClasses.has(value));
    const entry = { name, excluded, start: match.index + match[0].length };
    const conversionPlacement = attrs['data-placement'] && !attrs['data-placement'].startsWith('article-context');
    if (name === 'a' && !excluded && stack.some(item => item.name === 'p' || item.name === 'li')
      && !classes.includes('btn') && !Object.hasOwn(attrs, 'data-smart-cta') && !conversionPlacement) {
      entry.anchor = { attrs };
    }
    if (!voidTags.has(name) && !match[0].endsWith('/>')) stack.push(entry);
  }
  return anchors;
}

function serviceTarget(anchor, slug) {
  if (!anchor.attrs.href) return null;
  const url = new URL(anchor.attrs.href, `${origin}/blog/${slug}/`);
  if (url.origin !== origin) return null;
  if (url.pathname === '/contractors.html') return 'contractor';
  if (url.pathname === '/download.html') return 'app';
  if (['/', '/index.html'].includes(url.pathname) && ['#demo', '#features'].includes(url.hash)) return 'app';
  return null;
}

function resolveLink(href, slug) {
  const url = new URL(href, `${origin}/blog/${slug}/`);
  assert.equal(url.origin, origin, 'Expected an internal URL');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  assert.ok(fs.existsSync(file), `Missing destination: ${href}`);
  if (url.hash) {
    const ids = Array.from(fs.readFileSync(file, 'utf8').matchAll(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/g), match => match[1] ?? match[2]);
    assert.ok(ids.includes(decodeURIComponent(url.hash.slice(1))), `Missing destination fragment: ${href}`);
  }
}

function metadata(html, property) {
  const tags = Array.from(html.matchAll(/<meta\b[^>]*>/gi), match => attributes(match[0]));
  const meta = tags.find(attrs => attrs.property === property);
  assert.ok(meta, `Missing ${property} metadata`);
  return meta.content;
}

function schemaArticles(html) {
  const articles = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (attributes(match[1]).type !== 'application/ld+json') continue;
    const schema = JSON.parse(match[2]);
    const nodes = Array.isArray(schema) ? schema : schema['@graph'] || [schema];
    for (const node of nodes) {
      const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
      if (types.includes('Article') || types.includes('BlogPosting')) articles.push(node);
    }
  }
  assert.equal(articles.length, 1, 'One Article/BlogPosting entity describes the page');
  return articles;
}

test('contextual extraction excludes existing conversion-template links', () => {
  const fixture = '<nav><a href="/download.html">Navigation app</a></nav><article class="prose">'
    + '<div class="cta-inline"><p><a href="/download.html">Inline CTA app</a></p></div>'
    + '<section class="cta-final"><p><a href="/download.html">Final CTA app</a></p></section>'
    + '<div class="author"><p><a href="/contractors.html">Author contractor</a></p></div>'
    + '<p class="sources"><a href="/contractors.html">Source contractor</a></p>'
    + '<div class="related"><p><a href="/contractors.html">Related contractor</a></p></div>'
    + '<p>Try the <a href="/download.html"><strong>barcode comparison app</strong></a> for a product.</p>'
    + '<ul><li>Review a <a href="/contractors.html#sample-report">contractor savings report</a>.</li></ul>'
    + '</article><aside><a href="/download.html">Sidebar app</a></aside>';
  assert.deepEqual(contextualAnchors(fixture).map(anchor => anchor.text), ['barcode comparison app', 'contractor savings report']);
});

for (const page of pages) {
  test(`${page.slug}: adds a meaningful contextual ${page.intent} link outside template CTAs`, () => {
    // The pre-change HEAD had no contextual links to these service destinations.
    const anchors = contextualAnchors(page.html).filter(anchor => serviceTarget(anchor, page.slug) === page.intent);
    assert.ok(anchors.length >= 1, `No contextual ${page.intent} link in article.prose`);
    for (const anchor of anchors) {
      assert.ok(anchor.text.length >= 8, 'Anchor should describe its destination');
      assert.doesNotMatch(anchor.text, /^(?:click here|here|learn more|read more|this page|this link)$/i);
      assert.match(anchor.text, page.intent === 'app'
        ? /barcode|price|app|demo|feature|compar|scan|download|iphone|android|receipt|shopping|sav/i
        : /contractor|business|purchase|review|report|list|price|matching|service/i);
      assert.ok(!anchor.attrs.rel, `Internal links do not need nofollow or external rel attributes: ${anchor.attrs.href}`);
      resolveLink(anchor.attrs.href, page.slug);
    }
  });

  test(`${page.slug}: preserves direct external app-store destinations`, () => {
    const links = Array.from(page.html.matchAll(/<a\b([^>]*)>/gi), match => attributes(match[1]).href)
      .filter(href => href && /^https:\/\/(?:apps\.apple\.com|play\.google\.com)\//.test(href));
    assert.deepEqual(links, originalStoreLinks);
  });

  test(`${page.slug}: valid schema and update dates agree with visible text and sitemap`, () => {
    const article = schemaArticles(page.html)[0];
    assert.equal(article.datePublished, originalPublicationDate, 'Do not reset the original publication date for link edits');
    assert.equal(metadata(page.html, 'article:published_time'), originalPublicationDate);
    assert.match(article.dateModified, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(article.dateModified > originalPublicationDate, 'Changed content has a later modification date');
    assert.equal(new Date(article.dateModified).toISOString().slice(0, 10), article.dateModified, 'Modification date must be a real calendar date');
    assert.equal(metadata(page.html, 'article:modified_time'), article.dateModified);
    const visible = plain(page.html.match(/<header\b[^>]*class="blog-hero"[^>]*>([\s\S]*?)<\/header>/i)?.[1] || '');
    const updated = visible.match(/Updated\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/);
    assert.ok(updated, 'Visible article header has an Updated date');
    assert.equal(new Date(`${updated[1]} 00:00:00 UTC`).toISOString().slice(0, 10), article.dateModified);
    const canonical = `${origin}/blog/${page.slug}/`;
    const entries = Array.from(sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g), match => match[1])
      .filter(entry => entry.match(/<loc>([^<]*)<\/loc>/)?.[1] === canonical);
    assert.equal(entries.length, 1, 'Changed article has exactly one sitemap entry');
    assert.equal(entries[0].match(/<lastmod>([^<]*)<\/lastmod>/)?.[1], article.dateModified);
  });
}
