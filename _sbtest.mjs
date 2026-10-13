import { chromium } from 'playwright';
for (const [what, opts] of [
  ['headless default', {}],
  ['headless + flag', { args: ['--disable-features=OverlayScrollbar,FluentOverlayScrollbar,FluentScrollbar'] }],
  ['headed', { headless: false }],
]) {
  const b = await chromium.launch(opts);
  const p = await (await b.newContext()).newPage();
  await p.setContent(`<div id=d style="width:200px;height:100px;overflow:auto;scrollbar-color:#f00 #0f0">
    <div style="width:900px;height:400px"></div></div>`);
  const m = await p.evaluate(() => {
    const d = document.getElementById('d');
    return { takesSpace: d.offsetWidth - d.clientWidth, h: d.offsetHeight - d.clientHeight };
  });
  console.log(what.padEnd(18), JSON.stringify(m), m.takesSpace > 0 ? '-> CLASSIC, will show in a capture' : '-> overlay, invisible to a capture');
  await b.close();
}
