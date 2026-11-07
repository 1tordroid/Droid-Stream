#!/usr/bin/env node
// Weekly check of the photo downloader: reads one public post per site with
// the app's own site readers and the rules in rules/social-rules.json,
// signed out, with a normal browser user agent and one request per site.
//
//   node scripts/rules/check-sites.mjs                 print the results
//   node scripts/rules/check-sites.mjs --issues        also open, update or close one GitHub issue per site
//   --site instagram     check only this site
//   --max-requests 2     let every reader also try its fallback (default 1, or
//                        "requests" for a site in rules/site-checks.json)
//
// --issues needs GITHUB_TOKEN (issues: write) and GITHUB_REPOSITORY ("owner/repo").
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTs} from './load-ts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const option = name => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const MAX_REQUESTS = Number(option('--max-requests')) || 0;
const ONLY = option('--site');
const LABEL = 'site-check';
const TIMEOUT_MS = 25_000;

const app = await loadTs(join(root, 'scripts', 'rules', 'site-check-entry.ts'));
const checks = JSON.parse(readFileSync(join(root, 'rules', 'site-checks.json'), 'utf8')).posts;

class RequestLimit extends Error {}

/** A signed-out context like the app's, limited to [limit] requests. */
const context = limit => {
  let requests = 0;
  return {
    fetch: async (url, request = {}) => {
      requests += 1;
      if (requests > limit) throw new RequestLimit(`the reader wanted more than ${limit} request(s)`);
      const response = await fetch(url, {
        method: request.method || 'GET',
        headers: {'User-Agent': app.BROWSER_AGENT, 'Accept-Language': 'en-US,en;q=0.9', ...(request.headers || {})},
        body: request.body,
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return {status: response.status, url: response.url || url, text: await response.text()};
    },
    cookie: () => undefined,
    cookieHeader: () => '',
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    rules: app.BUNDLED_RULES,
  };
};

const checkSite = async (site, url, limit) => {
  const link = app.classifySocialUrl(url);
  if (!link || link.site !== site) return {site, url, ok: false, error: 'the check link is not a post of this site'};
  try {
    const post = await app.EXTRACTORS[site].extract(link, context(limit));
    const items = post.items.length;
    return {site, url, ok: items > 0, items, error: items ? undefined : 'no photos or videos found'};
  } catch (error) {
    const code = error?.code ? ` (${error.code})` : '';
    return {site, url, ok: false, error: `${error?.message || String(error)}${code}`};
  }
};

// ---------- GitHub issues ----------

const github = async (path, init = {}) => {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok && response.status !== 422) throw new Error(`GitHub ${init.method || 'GET'} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? undefined : response.json();
};

const titleFor = site => `Photo downloader: ${app.SITE_LABELS[site]} stopped working`;

const report = result =>
  [
    `The weekly site check could not read a public post on ${app.SITE_LABELS[result.site]}.`,
    '',
    `- Post: ${result.url}`,
    `- Error: ${result.error}`,
    `- Site rules version: ${app.BUNDLED_RULES.version}`,
    `- Run: ${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID || ''}`,
    '',
    'Fix the values in rules/social-rules.json (raise "version"); the push to main signs it, and phones take it within a day.',
    'Sites sometimes block the check servers; try the post in the app before changing rules.',
  ].join('\n');

const updateIssues = async results => {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) throw new Error('--issues needs GITHUB_TOKEN and GITHUB_REPOSITORY');
  await github('/labels', {method: 'POST', body: JSON.stringify({name: LABEL, color: 'd93f0b', description: 'Weekly photo downloader site check'})});
  const open = await github(`/issues?labels=${LABEL}&state=open&per_page=100`);
  for (const result of results) {
    const issue = open.find(entry => entry.title === titleFor(result.site) && !entry.pull_request);
    if (!result.ok && issue) {
      await github(`/issues/${issue.number}/comments`, {method: 'POST', body: JSON.stringify({body: `Still not working.\n\n${report(result)}`})});
      console.log(`updated issue #${issue.number} for ${result.site}`);
    } else if (!result.ok) {
      const created = await github('/issues', {method: 'POST', body: JSON.stringify({title: titleFor(result.site), body: report(result), labels: [LABEL]})});
      console.log(`opened issue #${created?.number} for ${result.site}`);
    } else if (issue) {
      await github(`/issues/${issue.number}/comments`, {method: 'POST', body: JSON.stringify({body: `Working again in the weekly check (${result.items} items from ${result.url}).`})});
      await github(`/issues/${issue.number}`, {method: 'PATCH', body: JSON.stringify({state: 'closed', state_reason: 'completed'})});
      console.log(`closed issue #${issue.number} for ${result.site}`);
    }
  }
};

const results = [];
for (const [site, entry] of Object.entries(checks)) {
  if (ONLY && site !== ONLY) continue;
  if (!app.EXTRACTORS[site]) throw new Error(`unknown site in rules/site-checks.json: ${site}`);
  // An entry is a link, or {"url": ..., "requests": 2} for a reader whose first request is often blocked.
  const url = typeof entry === 'string' ? entry : entry.url;
  const limit = MAX_REQUESTS || Math.min(3, Math.max(1, Number(entry.requests) || 1));
  const result = await checkSite(site, url, limit);
  results.push(result);
  console.log(`${result.ok ? 'ok    ' : 'BROKEN'} ${site.padEnd(10)} ${result.ok ? `${result.items} items` : result.error}`);
}
if (args.includes('--issues')) await updateIssues(results);
