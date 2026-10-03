/* ============================================================
   md.js — the small markdown subset problem statements are
   written in.

   Everything is escaped before anything is rendered. The content
   is yours, but a renderer that trusts its input is a bug waiting
   for the day it does not — and problem files are fetched over
   the network like anything else.

   Supported: headings, bold, italic, inline code, fenced code
   (highlighted by Highlight when a language is named), links,
   unordered and ordered lists, tables, blockquotes, rules,
   paragraphs. Deliberately not: images, HTML passthrough,
   reference links, nested lists.
   ============================================================ */

const MD = (() => {

  const escapeHtml = s => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  /* Only http(s), mailto and in-page fragments. A javascript: URL in a link
     is the one thing escaping the text would not have stopped. */
  function safeHref(url) {
    const u = String(url).trim();
    return /^(https?:\/\/|mailto:|#|\/)/i.test(u) ? u : '#';
  }

  /* ---------------- inline ----------------
     Runs on already-escaped text. Code spans are pulled out first so that
     asterisks and underscores inside them survive to the end.

     The placeholder is "<<n>>", which cannot collide with anything in the
     text: by the time this runs every real "<" has already become "&lt;", so
     a literal "<<" is impossible. A printable sentinel like " n " would have
     matched ordinary prose such as "in 5 steps" and quietly turned a number
     into a code span. */
  function inline(text) {
    const spans = [];
    let out = String(text).replace(/`([^`]+)`/g, (_, code) => {
      spans.push(`<code>${code}</code>`);
      return `<<${spans.length - 1}>>`;
    });

    out = out
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
        (_, label, url) => `<a href="${escapeHtml(safeHref(url))}" target="_blank" rel="noopener noreferrer">${label}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[^\w_])_([^_\n]+)_(?=[^\w_]|$)/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return out.replace(/<<(\d+)>>/g, (_, i) => spans[Number(i)]);
  }

  /* ---------------- blocks ---------------- */

  function render(src) {
    if (!src) return '';
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      /* Fenced code. Escaped, then handed to the highlighter if a language is
         named — the highlighter works on already-escaped text for that reason. */
      const fence = line.match(/^```\s*([\w+#-]*)\s*$/);
      if (fence) {
        const lang = fence[1] || '';
        const body = [];
        i += 1;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
        i += 1;
        const escaped = escapeHtml(body.join('\n'));
        const code = (lang && typeof Highlight !== 'undefined')
          ? Highlight.run(escaped, lang)
          : escaped;
        out.push(
          `<pre class="code-block"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>` +
          `<code>${code}</code></pre>`
        );
        continue;
      }

      if (/^\s*$/.test(line)) { i += 1; continue; }

      if (/^(---+|\*\*\*+)\s*$/.test(line)) { out.push('<hr>'); i += 1; continue; }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
        i += 1;
        continue;
      }

      /* Tables: a header row, a separator of dashes, then body rows. The
         separator is what tells a table apart from a line containing pipes. */
      if (line.includes('|') && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i + 1] || '')) {
        const cells = row => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
        const head = cells(line);
        const align = cells(lines[i + 1]).map(c =>
          /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : 'left');
        i += 2;
        const body = [];
        while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) body.push(cells(lines[i++]));
        const th = head.map((c, n) =>
          `<th style="text-align:${align[n] || 'left'}">${inline(escapeHtml(c))}</th>`).join('');
        const tr = body.map(r =>
          `<tr>${r.map((c, n) =>
            `<td style="text-align:${align[n] || 'left'}">${inline(escapeHtml(c))}</td>`).join('')}</tr>`).join('');
        out.push(`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const body = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push(`<blockquote>${render(body.join('\n'))}</blockquote>`);
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i++].replace(/^\s*[-*+]\s+/, ''));
        }
        out.push(`<ul>${items.map(t => `<li>${inline(escapeHtml(t))}</li>`).join('')}</ul>`);
        continue;
      }

      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items = [];
        const start = Number(line.match(/^\s*(\d+)/)[1]);
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
        }
        out.push(`<ol${start !== 1 ? ` start="${start}"` : ''}>` +
                 `${items.map(t => `<li>${inline(escapeHtml(t))}</li>`).join('')}</ol>`);
        continue;
      }

      /* A paragraph runs until a blank line or the start of another block. */
      const para = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^```/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) &&
             !/^\s*>/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) &&
             !/^\s*\d+[.)]\s+/.test(lines[i]) && !/^(---+|\*\*\*+)\s*$/.test(lines[i])) {
        para.push(lines[i++]);
      }
      out.push(`<p>${inline(escapeHtml(para.join('\n')))}</p>`);
    }

    return out.join('\n');
  }

  /* For the places that want one line of markdown without a <p> around it. */
  const renderInline = src => inline(escapeHtml(String(src || '')));

  return { render, renderInline, escapeHtml, safeHref };
})();

