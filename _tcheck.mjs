import fs from 'node:fs';
import { strict as assert } from 'node:assert';

/* The same matcher build-index.mjs uses, imported rather than copied. */
const src = fs.readFileSync('scripts/build-index.mjs', 'utf8');
const start = src.indexOf('const printsCheck = ');
const end = src.indexOf('\n};', start) + 3;
const printsCheck = eval(`(${src.slice(start + 'const printsCheck = '.length, end - 1)})`);

const pay = JSON.parse(fs.readFileSync('problems/fpga/hdl-mux2.json', 'utf8')).payload;
console.log('generated names (the loop in hdl-mux2):');
for (const n of ['row3_sel0_a1_b1', 'row7_sel1_a1_b1', 'row0_sel0_a0_b0']) {
  console.log(' ', String(printsCheck(pay.testbench, n)).padEnd(6), n);
}
console.log('and names it must still reject:');
for (const n of ['rowsel', 'counted', 'wraps', 'row3_sel0_a1', 'row3_sel0_a1_b1_extra']) {
  console.log(' ', String(printsCheck(pay.testbench, n)).padEnd(6), n);
}

const ctr = JSON.parse(fs.readFileSync('solutions/hdl-counter.json', 'utf8')).key;
console.log('literal harnesses are unaffected:');
for (const n of ['wraps', 'at_top', 'nonexistent']) {
  console.log(' ', String(printsCheck(ctr.harness, n)).padEnd(6), n);
}
