import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '..');
const sourceDirectory = path.join(root, 'src');
const distDirectory = path.join(root, 'dist');
const docsAssetsDirectory = path.join(root, 'docs', 'assets');

async function collectJavaScriptFiles(directory, base = directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJavaScriptFiles(fullPath, base));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.relative(base, fullPath).split(path.sep).join('/'));
  }
  return files.sort();
}

function indent(source, spaces = 4) {
  const prefix = ' '.repeat(spaces);
  return source.split('\n').map((line) => (line ? `${prefix}${line}` : '')).join('\n');
}

const files = await collectJavaScriptFiles(sourceDirectory);
const modules = [];
for (const id of files) {
  const source = await fs.readFile(path.join(sourceDirectory, id), 'utf8');
  modules.push(`${JSON.stringify(id)}: function(module, exports, require) {\n${indent(source.trimEnd(), 4)}\n  }`);
}

const bundle = `/*!
 * BMS Difficulty Table Downloader
 * Built from the files in /src. Do not edit this generated file directly.
 */
(function () {
  'use strict';

  const __modules = {
  ${modules.join(',\n  ')}
  };
  const __cache = Object.create(null);

  function __resolve(parentId, request) {
    if (!request.startsWith('.')) return request.endsWith('.js') ? request : request + '.js';
    const base = parentId.split('/');
    base.pop();
    for (const part of request.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') base.pop();
      else base.push(part);
    }
    let resolved = base.join('/');
    if (!resolved.endsWith('.js')) resolved += '.js';
    return resolved;
  }

  function __require(request, parentId = '') {
    const id = parentId ? __resolve(parentId, request) : request;
    if (__cache[id]) return __cache[id].exports;
    const factory = __modules[id];
    if (!factory) throw new Error('Module not found: ' + id + (parentId ? ' (required by ' + parentId + ')' : ''));
    const module = { exports: {} };
    __cache[id] = module;
    factory(module, module.exports, (childRequest) => __require(childRequest, id));
    return module.exports;
  }

  __require('main.js');
})();
`;

await fs.mkdir(distDirectory, { recursive: true });
await fs.mkdir(docsAssetsDirectory, { recursive: true });

const outputPaths = [
  path.join(distDirectory, 'starlight-difficulty-downloader.js'),
  path.join(docsAssetsDirectory, 'starlight-difficulty-downloader.js')
];
for (const outputPath of outputPaths) await fs.writeFile(outputPath, bundle, 'utf8');

const hash = crypto.createHash('sha256').update(bundle).digest('hex');
await fs.writeFile(path.join(distDirectory, 'SHA256SUMS.txt'), `${hash}  starlight-difficulty-downloader.js\n`, 'utf8');

console.log(`Built ${files.length} modules.`);
console.log(`Bundle: ${bundle.length.toLocaleString()} bytes`);
console.log(`SHA-256: ${hash}`);
