/* Pin the browser Rust toolchain into vendor/rust.

   Two artifacts, both from the weblings deployment, both verified
   against the SHA-256 digests already in vendor/rust/manifest.json. A
   digest that does not match aborts without writing anything — an
   unpinned compiler is the one dependency this site cannot have, since
   it is the part that executes code.

     npm run vendor:rust              re-download and verify
     npm run vendor:rust -- --check   verify what is already there
     npm run vendor:rust -- --accept  write new digests (re-pinning)

   --accept is how the pin is deliberately moved to a newer build. It
   prints the old and new digests so the change is visible in the diff
   rather than happening quietly. */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'vendor', 'rust');
const MANIFEST = path.join(DIR, 'manifest.json');

const CHECK = process.argv.includes('--check');
const ACCEPT = process.argv.includes('--accept');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const digest = buf => crypto.createHash('sha256').update(buf).digest('hex');

let bad = 0;

for (const [name, want] of Object.entries(manifest.files)) {
  const dest = path.join(DIR, name);

  let bytes;
  if (CHECK) {
    if (!fs.existsSync(dest)) {
      console.error(`-- ${name}: missing`);
      bad += 1;
      continue;
    }
    bytes = fs.readFileSync(dest);
  } else {
    const url = `${manifest.source}/rustc/${name}`;
    process.stdout.write(`   ${name} … `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
    bytes = Buffer.from(await res.arrayBuffer());
    console.log(`${(bytes.length / 1e6).toFixed(1)} MB`);
  }

  const got = digest(bytes);
  if (got !== want.sha256) {
    if (ACCEPT && !CHECK) {
      console.log(`   ${name}: re-pinned`);
      console.log(`     was ${want.sha256}`);
      console.log(`     now ${got}`);
      manifest.files[name] = { bytes: bytes.length, sha256: got };
    } else {
      console.error(`-- ${name}: digest does not match the pin`);
      console.error(`     want ${want.sha256}`);
      console.error(`     got  ${got}`);
      bad += 1;
      continue;
    }
  }

  if (!CHECK) fs.writeFileSync(dest, bytes);
}

if (bad) {
  console.error(`\n${bad} artifact${bad === 1 ? '' : 's'} did not verify. Nothing was changed.`);
  console.error('If the upstream build moved on purpose, re-pin with --accept.');
  process.exit(1);
}

if (ACCEPT && !CHECK) {
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(CHECK
  ? '\nvendor/rust matches its pins.'
  : '\nvendor/rust is current. Re-run npm run audit:rust if the compiler changed.');
