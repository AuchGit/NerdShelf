// scripts/patch-android-updater.mjs
//
// Downloads the latest.json that the desktop release job uploaded, adds
// android-{arch} entries pointing to the freshly built+signed APKs, and
// re-uploads the patched latest.json to the same GitHub release.
//
// Invoked from the release workflow:
//   node scripts/patch-android-updater.mjs <tag> <owner/repo> <stage_dir>
//
// Requires env: GITHUB_TOKEN
//
// Stage dir is expected to contain pairs of files:
//   NerdShelf_<tag>_android-<arch>.apk
//   NerdShelf_<tag>_android-<arch>.apk.sig

import fs from 'node:fs/promises';
import path from 'node:path';

const [, , tag, repo, stageDir] = process.argv;
if (!tag || !repo || !stageDir) {
  console.error('Usage: node patch-android-updater.mjs <tag> <owner/repo> <stage_dir>');
  process.exit(1);
}

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN env required');
  process.exit(1);
}

const api = `https://api.github.com/repos/${repo}`;
const ghHeaders = {
  'Authorization': `Bearer ${token}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function gh(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...ghHeaders, ...(opts.headers || {}) } });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`GitHub ${opts.method || 'GET'} ${url} → ${r.status}: ${txt}`);
  }
  return r;
}

// 1. Resolve release + assets
const release = await (await gh(`${api}/releases/tags/${tag}`)).json();
const assets = release.assets;
const latestJsonAsset = assets.find(a => a.name === 'latest.json');
if (!latestJsonAsset) {
  console.error('latest.json not found on release. Did the desktop job run with includeUpdaterJson?');
  process.exit(1);
}

// 2. Download existing latest.json
const latest = await (await fetch(latestJsonAsset.browser_download_url)).json();
console.log('Existing latest.json platforms:', Object.keys(latest.platforms || {}));

// 3. Find every android-<arch> APK + .sig pair in the staging dir
const ARCHES = ['aarch64', 'armv7', 'i686', 'x86_64'];
const files = await fs.readdir(stageDir);

for (const arch of ARCHES) {
  const apkName = files.find(f => f.endsWith(`android-${arch}.apk`));
  const sigName = files.find(f => f.endsWith(`android-${arch}.apk.sig`));
  if (!apkName || !sigName) {
    console.warn(`Skipping android-${arch}: missing APK or .sig (apk=${apkName}, sig=${sigName})`);
    continue;
  }
  const apkAsset = assets.find(a => a.name === apkName);
  if (!apkAsset) {
    console.warn(`Skipping android-${arch}: ${apkName} not yet on release`);
    continue;
  }
  const signature = (await fs.readFile(path.join(stageDir, sigName), 'utf8')).trim();
  latest.platforms = latest.platforms || {};
  latest.platforms[`android-${arch}`] = {
    signature,
    url: apkAsset.browser_download_url,
  };
  console.log(`Added android-${arch} → ${apkAsset.browser_download_url}`);
}

// 4. Replace latest.json on the release: delete the old one, upload the new one.
await gh(`${api}/releases/assets/${latestJsonAsset.id}`, { method: 'DELETE' });

const uploadUrl = release.upload_url.replace(/\{\?[^}]+\}/, '') + '?name=latest.json';
const body = Buffer.from(JSON.stringify(latest, null, 2));
const upR = await fetch(uploadUrl, {
  method: 'POST',
  headers: { ...ghHeaders, 'Content-Type': 'application/json', 'Content-Length': String(body.length) },
  body,
});
if (!upR.ok) {
  const txt = await upR.text().catch(() => '');
  throw new Error(`Upload latest.json → ${upR.status}: ${txt}`);
}
console.log('Patched latest.json uploaded successfully.');
console.log('Final platforms:', Object.keys(latest.platforms));
