// Run with: node --test tests/contractors.test.cjs
// All DOM, storage, measurement and clipboard operations below are local stubs.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'contractors.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'contractors.js'), 'utf8');
const email = 'imran@pricematchparadise.com';
const consentKey = 'pmp-ad-consent-v1';
const adsId = 'AW-18175529367';

function attributes(raw) {
  const result = {};
  for (const match of raw.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1]] = (match[2] ?? match[3]).replaceAll('&amp;', '&');
  }
  return result;
}

function tags(text = html) {
  return Array.from(text.matchAll(/<([a-z][\w:-]*)\b([^>]*?)>/gi), match => ({
    name: match[1].toLowerCase(), raw: match[2], attrs: attributes(match[2])
  }));
}

function plain(text) {
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cents(text) {
  const match = plain(text).match(/\$([\d,]+(?:\.\d{2})?)/);
  assert.ok(match, 'Expected a displayed dollar amount');
  return Math.round(Number(match[1].replaceAll(',', '')) * 100);
}

function boot(options = {}) {
  const nodes = new Map();
  const appendedScripts = [];
  const storageWrites = [];
  const clipboardWrites = [];

  class Element {
    constructor(attrs = {}, hidden = false) {
      this.attrs = attrs;
      this.hidden = hidden;
      this.textContent = '';
      this.dataset = { b2bEvent: attrs['data-b2b-event'] };
      this.listeners = new Map();
      this.focused = false;
    }
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(listener);
    }
    async click() {
      for (const listener of this.listeners.get('click') || []) await listener({ target: this });
    }
    focus() { this.focused = true; }
  }

  const taggedElements = tags();
  for (const tag of taggedElements) {
    if (tag.attrs.id) nodes.set(tag.attrs.id, new Element(tag.attrs, /(?:^|\s)hidden(?:\s|$)/.test(tag.raw)));
  }
  const trackedLinks = taggedElements.filter(tag => tag.attrs['data-b2b-event']).map(tag => new Element(tag.attrs));
  for (const event of options.extraEvents || []) trackedLinks.push(new Element({ 'data-b2b-event': event }));

  const window = { isSecureContext: options.secure !== false };
  const navigator = {};
  if (options.clipboard !== false) navigator.clipboard = {
    writeText: async value => {
      clipboardWrites.push(value);
      if (options.clipboardFailure) throw new Error('Stub clipboard rejected');
    }
  };
  const document = {
    getElementById: id => nodes.get(id),
    querySelectorAll: selector => {
      assert.equal(selector, '[data-b2b-event]');
      return trackedLinks;
    },
    createElement: name => {
      assert.equal(name, 'script');
      return new Element();
    },
    head: { appendChild: script => appendedScripts.push(script) }
  };
  const localStorage = {
    getItem: key => {
      assert.equal(key, consentKey);
      if (options.storageReadFailure) throw new Error('Stub storage blocked');
      return options.savedConsent ?? null;
    },
    setItem: (key, value) => {
      assert.equal(key, consentKey);
      if (options.storageWriteFailure) throw new Error('Stub storage blocked');
      storageWrites.push({ key, value });
    }
  };

  vm.runInNewContext(source, { window, document, navigator, localStorage }, { filename: 'contractors.js' });
  const calls = () => Array.from(window.dataLayer || [], args => JSON.parse(JSON.stringify(Array.from(args))));
  const events = () => calls().filter(call => call[0] === 'event');
  return { nodes, trackedLinks, appendedScripts, storageWrites, clipboardWrites, window, calls, events };
}

test('structured data is valid JSON and describes the BC manual service', () => {
  const scripts = Array.from(html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g));
  assert.equal(scripts.length, 1);
  const schema = JSON.parse(scripts[0][1]);
  assert.equal(schema['@context'], 'https://schema.org');
  const graph = schema['@graph'];
  assert.equal(new Set(graph.map(item => item['@id'])).size, graph.length);
  const organization = graph.find(item => item['@type'] === 'Organization');
  const service = graph.find(item => item['@type'] === 'Service');
  const page = graph.find(item => item['@type'] === 'WebPage');
  assert.equal(organization.email, email);
  assert.equal(service.provider['@id'], organization['@id']);
  assert.equal(page.mainEntity['@id'], service['@id']);
  assert.equal(page.url, 'https://pricematchparadise.com/contractors.html');
  assert.equal(page.inLanguage, 'en-CA');
  assert.equal(service.areaServed.name, 'British Columbia, Canada');
  assert.match(service.description, /Unlimited purchase lists/);
  assert.match(service.description, /documented realized savings/);
});

test('IDs are unique and every local page, anchor and asset link resolves', () => {
  const ids = tags().map(tag => tag.attrs.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML ID');
  for (const tag of tags()) {
    for (const attribute of ['href', 'src']) {
      const value = tag.attrs[attribute];
      if (!value || /^(?:https?:|mailto:|data:)/i.test(value)) continue;
      const [file, fragment] = value.split('#');
      const resolved = file ? path.join(root, decodeURIComponent(file.replace(/^\//, ''))) : path.join(root, 'contractors.html');
      assert.ok(fs.existsSync(resolved), `Missing local resource: ${value}`);
      if (fragment) {
        const targetIds = tags(fs.readFileSync(resolved, 'utf8')).map(element => element.attrs.id);
        assert.ok(targetIds.includes(decodeURIComponent(fragment)), `Missing fragment: ${value}`);
      }
    }
  }
});

test('email draft and template remain actionable HTML links without JavaScript', () => {
  const anchors = tags().filter(tag => tag.name === 'a');
  const draft = anchors.find(tag => (tag.attrs.class || '').includes('b2b-email-link'));
  const draftURL = new URL(draft.attrs.href);
  assert.equal(draftURL.protocol, 'mailto:');
  assert.equal(draftURL.pathname, email);
  assert.equal(draftURL.searchParams.get('subject'), 'BC contractor - free 30-day purchase-list review');
  const body = draftURL.searchParams.get('body');
  for (const field of ['Business name:', 'Contact name:', 'BC city and postal code:', 'Usual retailer(s):', 'Purchase deadline:', 'List type (upcoming purchase or previous invoice):']) assert.ok(body.includes(field));
  assert.ok(body.includes('\n\n'));
  assert.ok(!body.includes('%20'), 'Draft must decode cleanly');
  assert.match(draft.attrs.href, /%0A/);
  assert.ok(anchors.some(tag => tag.attrs.href === `mailto:${email}`), 'Plain email fallback is present');
  const template = anchors.find(tag => tag.attrs['data-b2b-event'] === 'b2b_template_download');
  assert.equal(template.attrs.href, 'assets/templates/contractor-purchase-list.csv');
  assert.match(template.raw, /\bdownload=/);
  assert.match(html, /This opens a draft—it does not send your list or activate the trial/);
  assert.ok(!tags().some(tag => tag.name === 'form'), 'No simulated upload or submission form');
});

test('purchase-list template has all agreed intake fields and no example client data', () => {
  const csv = fs.readFileSync(path.join(root, 'assets/templates/contractor-purchase-list.csv'), 'utf8').trim();
  assert.equal(csv.split(/\r?\n/).length, 1);
  assert.deepEqual(csv.split(','), [
    'product_name', 'brand', 'model_or_sku', 'upc', 'quantity', 'pack_size_or_kit_contents',
    'usual_retailer', 'net_unit_price_cad', 'previous_purchase_date', 'purchase_deadline', 'notes'
  ]);
});

test('illustrative row savings and both displayed report totals reconcile', () => {
  const table = html.match(/<table class="b2b-report-table">([\s\S]*?)<\/table>/)[1];
  const tbody = table.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  const rows = Array.from(tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g));
  assert.equal(rows.length, 3);
  let baseline = 0;
  let alternative = 0;
  let savings = 0;
  for (const row of rows) {
    const cells = Array.from(row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g), match => match[1]);
    const quantity = Number(plain(cells[1]));
    const usual = cents(cells[2]);
    const cheaper = cents(cells[3]);
    const displayedSaving = cents(cells[4]);
    assert.equal((usual - cheaper) * quantity, displayedSaving);
    baseline += usual * quantity;
    alternative += cheaper * quantity;
    savings += displayedSaving;
  }
  assert.equal(baseline, 500000);
  assert.equal(alternative, 420000);
  assert.equal(savings, 80000);
  assert.equal(baseline - alternative, savings);
  const totals = html.match(/<div class="b2b-report-totals">([\s\S]*?)<\/div>\s*<p/)[1];
  assert.deepEqual(Array.from(totals.matchAll(/<strong\b[^>]*>([^<]+)<\/strong>/g), match => cents(match[1])), [baseline, alternative, savings]);
  assert.match(html, /Fictional products and retailers/);
  assert.match(html, /None of these example savings are confirmed/);
});

test('measurement is absent before consent and remains absent when denied', async () => {
  assert.ok(!tags().some(tag => tag.name === 'script' && /googletagmanager|facebook/i.test(tag.attrs.src || '')));
  const app = boot();
  assert.equal(app.nodes.get('consentBanner').hidden, false);
  assert.equal(app.appendedScripts.length, 0);
  assert.equal(app.window.gtag, undefined);
  await app.nodes.get('rejectConsent').click();
  for (const link of app.trackedLinks) await link.click();
  assert.equal(app.appendedScripts.length, 0);
  assert.deepEqual(app.events(), []);
  assert.deepEqual(app.storageWrites, [{ key: consentKey, value: 'denied' }]);
  assert.equal(boot({ savedConsent: 'denied' }).appendedScripts.length, 0);
});

test('allowed consent loads the configured Google Ads script exactly once', async () => {
  const app = boot();
  await app.nodes.get('acceptConsent').click();
  await app.nodes.get('acceptConsent').click();
  assert.equal(app.appendedScripts.length, 1);
  assert.equal(app.appendedScripts[0].src, `https://www.googletagmanager.com/gtag/js?id=${adsId}`);
  assert.equal(app.appendedScripts[0].async, true);
  assert.equal(app.calls().filter(call => call[0] === 'config' && call[1] === adsId).length, 1);
  assert.equal(app.nodes.get('consentBanner').hidden, true);
  const saved = boot({ savedConsent: 'granted' });
  assert.equal(saved.appendedScripts.length, 1);
  assert.equal(saved.nodes.get('consentBanner').hidden, true);
});

test('only permitted inquiry events are measured and their payloads contain no personal data', async () => {
  const app = boot({ savedConsent: 'granted', extraEvents: ['Lead', 'conversion', 'page_view', 'unknown_event'] });
  for (const link of app.trackedLinks) await link.click();
  assert.equal(app.events().length, 3, 'Two email links and one template link are tracked');
  assert.deepEqual(app.events().map(call => call[1]).sort(), ['b2b_email_click', 'b2b_email_click', 'b2b_template_download']);
  for (const event of app.events()) {
    assert.deepEqual(event[2], { event_category: 'contractor_inquiry', transport_type: 'beacon' });
    assert.ok(!JSON.stringify(event).includes(email));
    assert.ok(!JSON.stringify(event).includes('mailto:'));
  }
  await app.nodes.get('copyEmail').click();
  assert.equal(app.events().length, 3, 'Copying an address is not a trial or lead conversion');
});

test('revoking consent updates all Google consent fields and stops future click measurement', async () => {
  const app = boot({ savedConsent: 'granted' });
  await app.trackedLinks[0].click();
  const count = app.events().length;
  await app.nodes.get('privacyChoices').click();
  assert.equal(app.nodes.get('consentBanner').hidden, false);
  assert.equal(app.nodes.get('rejectConsent').focused, true);
  await app.nodes.get('rejectConsent').click();
  for (const link of app.trackedLinks) await link.click();
  assert.equal(app.events().length, count);
  const updates = app.calls().filter(call => call[0] === 'consent' && call[1] === 'update');
  assert.deepEqual(updates.at(-1)[2], { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  assert.equal(app.appendedScripts.length, 1);
});

test('malformed saved consent and blocked storage default to no measurement', async () => {
  for (const value of ['', 'true', 'GRANTED', '{"state":"granted"}', 'unexpected']) {
    const app = boot({ savedConsent: value });
    assert.equal(app.appendedScripts.length, 0);
    assert.equal(app.nodes.get('consentBanner').hidden, false);
    for (const link of app.trackedLinks) await link.click();
    assert.deepEqual(app.events(), []);
  }
  const blocked = boot({ storageReadFailure: true, storageWriteFailure: true });
  assert.equal(blocked.appendedScripts.length, 0);
  await blocked.nodes.get('rejectConsent').click();
  assert.equal(blocked.appendedScripts.length, 0);
  await blocked.nodes.get('acceptConsent').click();
  assert.equal(blocked.appendedScripts.length, 1, 'An explicit current-page choice works even when storage is blocked');
  assert.deepEqual(blocked.storageWrites, []);
});

test('clipboard enhancement copies only the public address and announces success', async () => {
  const app = boot();
  assert.equal(app.nodes.get('copyEmail').hidden, false);
  await app.nodes.get('copyEmail').click();
  assert.deepEqual(app.clipboardWrites, [email]);
  assert.equal(app.nodes.get('copyStatus').textContent, 'Email address copied.');
  assert.equal(tags().find(tag => tag.attrs.id === 'copyStatus').attrs.role, 'status');
});

test('clipboard failure has a usable fallback; missing or insecure clipboard stays hidden', async () => {
  const failure = boot({ clipboardFailure: true });
  await failure.nodes.get('copyEmail').click();
  assert.equal(failure.nodes.get('copyStatus').textContent, 'Please select and copy the address above.');
  for (const options of [{ clipboard: false }, { secure: false }]) {
    const app = boot(options);
    assert.equal(app.nodes.get('copyEmail').hidden, true);
    await app.nodes.get('copyEmail').click();
    assert.deepEqual(app.clipboardWrites, []);
  }
});
