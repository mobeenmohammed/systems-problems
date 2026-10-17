/* Pin the browser Rust toolchain into vendor/rust.

   Two artifacts, both from the weblings deployment, both verified
   against the SHA-256 digests already in vendor/rust/manifest.json. A
   digest that does not match aborts without writing anything — an
   unpinned compiler is the one dependency this site cannot have, since
   it is the part that executes code.

     npm run vendor:rust              re-download and verify
     npm run vendor:rust -- --check   verify what is already there
     npm run vendor:rust -- --accept  write new digests (re-pinning)
     npm run vendor:rust -- --from <dir> --accept
                                      pin a locally built compiler

   --accept is how the pin is deliberately moved to a newer build. It
   prints the old and new digests so the change is visible in the diff
   rather than happening quietly.

   --from takes the artifacts out of a directory instead of off the
   network, which is how a compiler built by
   scripts/build-rustc-wasm.sh gets in. It records where it came from
   in the manifest, because "a real rustc from upstream" and "upstream
   plus a patch of ours" are different claims and the file that pins
   the compiler is the place to tell them apart. */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'vendor', 'rust');
const MANIFEST = path.join(DIR, 'manifest.json');

const CHECK = process.argv.includes('--check');
const ACCEPT = process.argv.includes('--accept');
const fromIdx = process.argv.indexOf('--from');
const FROM = fromIdx > -1 ? process.argv[fromIdx + 1] : null;
if (fromIdx > -1 && !FROM) {
  console.error('--from needs a directory');
  process.exit(2);
}

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
  } else if (FROM) {
    const src = path.join(FROM, name);
    if (!fs.existsSync(src)) {
      console.error(`-- ${name}: not in ${FROM}`);
      bad += 1;
      continue;
    }
    bytes = fs.readFileSync(src);
    console.log(`   ${name} … ${(bytes.length / 1e6).toFixed(1)} MB (local)`);
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
  if (FROM) {
    /* Where this compiler came from, in the file that pins it. A
       locally built one is not the upstream artifact and the manifest
       should not go on implying that it is. */
    manifest.builtHere = {
      how: 'scripts/build-rustc-wasm.sh',
      upstream: 'AngelOnFira/rust @ riw-wasm20',
      patch: 'patches/clif2wasm-smulhi.patch — lowers smulhi.i64 and umulhi.i64',
      llvm: 'LLVM 21.1.0 release (the branch\'s download-ci-llvm artifact has expired)',
      at: new Date().toISOString().slice(0, 10),
    };
  }
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(CHECK
  ? '\nvendor/rust matches its pins.'
  : '\nvendor/rust is current. Re-run npm run audit:rust if the compiler changed.');
