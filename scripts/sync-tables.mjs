import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, 'docs/data');
const sources = [
  {
    filename: 'stardust.json',
    url: 'https://mqppppp.neocities.org/StardustData.json'
  },
  {
    filename: 'satellite.json',
    url: 'https://stellabms.xyz/sl/score.json'
  },
  {
    filename: 'stella.json',
    url: 'https://stellabms.xyz/st/score.json'
  }
];

await mkdir(destination, { recursive: true });

for (const source of sources) {
  const response = await fetch(source.url, { headers: { 'user-agent': 'BMS-Difficulty-Table-Downloader/1.0' } });
  if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${source.url}: expected a non-empty JSON array`);
  await writeFile(resolve(destination, source.filename), `${JSON.stringify(rows)}\n`, 'utf8');
  console.log(`${source.filename}: ${rows.length} charts`);
}
