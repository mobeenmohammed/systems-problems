/* Pin the browser Verilog toolchain into vendor/verilog.

   Six artifacts: the three stages of Icarus Verilog 14.0 compiled to
   WebAssembly with Emscripten, each a .js loader and its .wasm.

     ivlpp   the preprocessor: macros and includes
     ivl     the compiler: elaborates the design and emits .vvp
     vvp     the runtime: executes the .vvp and writes the VCD

   From senolgulgonul/verisim, pinned to one commit — a tag would be
   nicer but the project does not cut them, and a commit sha on
   raw.githubusercontent.com is immutable, which is what matters for a
   dependency that executes code.

   LICENSING, and it is the one thing to read before changing this
   file. Icarus Verilog is GPL-2.0-or-later, so these six files are a
   redistribution of a GPL work. Three obligations follow and all three
   are met in the tree rather than assumed:

     · the licence travels with the binaries — vendor/verilog/COPYING
     · the redistribution is identified exactly, so "corresponding
       source" is a specific thing and not a gesture: the upstream
       project, the commit, and the Icarus release the binaries were
       built from are all in vendor/verilog/manifest.json, and
       vendor/verilog/README.md says where the source is
     · the binaries are unmodified. They are downloaded and checked
       against a digest; nothing here patches them

   The digests are checked on every re-pin and a mismatch aborts
   without writing.

     npm run vendor:hdl              re-download and verify
     npm run vendor:hdl -- --check   verify what is already there
     npm run vendor:hdl -- --accept  write new digests (re-pinning)

   --accept is how the pin is deliberately moved. It prints the old and
   the new digest so the change is visible in the diff rather than
   happening quietly. */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'vendor', 'verilog');
const MANIFEST = path.join(DIR, 'manifest.json');

const CHECK = process.argv.includes('--check');
const ACCEPT = process.argv.includes('--accept');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const digest = buf => crypto.createHash('sha256').update(buf).digest('hex');

const base = `${manifest.source}/${manifest.commit}`;
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
    const url = `${base}/${name}`;
    process.stdout.write(`   ${name} … `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
    bytes = Buffer.from(await res.arrayBuffer());
    console.log(`${(bytes.length / 1e3).toFixed(0)} kB`);
  }

  const got = digest(bytes);
  if (got !== want.sha256) {
    if (ACCEPT && !CHECK) {
      console.log(`   ${name}: re-pinned`);
      console.log(`     was ${want.sha256}`);
      console.log(`     now ${got}`);
      manifest.files[name] = { bytes: bytes.length, sha256: got };
    } else {
      console.error(`-- ${name}: DIGEST MISMATCH`);
      console.error(`   want ${want.sha256}`);
      console.error(`   got  ${got}`);
      bad += 1;
      continue;
    }
  }

  if (!CHECK) fs.writeFileSync(dest, bytes);
}

if (bad) {
  console.error(`\n${bad} artifact${bad === 1 ? '' : 's'} did not match. Nothing was written.`);
  console.error('If this is a deliberate upgrade: npm run vendor:hdl -- --accept');
  process.exit(1);
}

if (ACCEPT && !CHECK) {
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('\nmanifest.json updated. Re-run npm run audit:hdl.');
} else if (CHECK) {
  console.log('\nvendor/verilog is current.');
} else {
  console.log('\nvendor/verilog is current. Re-run npm run audit:hdl if the simulator changed.');
}
