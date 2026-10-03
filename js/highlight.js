/* ============================================================
   highlight.js — syntax colouring for code that is *displayed*.

   It runs on text that MD has already escaped, so the input
   contains &lt; and &amp; rather than < and &. That is why every
   pattern here is written against escaped text, and why the
   output can be inserted as HTML: nothing is unescaped on the way
   through.

   One pass, one combined regular expression per language, so a
   keyword inside a string or a comment can never be recoloured —
   whichever alternative starts earliest wins the span.

   Code you *type* is not highlighted. Keeping a coloured overlay
   in scroll-sync with a textarea is a lot of fiddly code for a
   cosmetic win; see js/editor.js.
   ============================================================ */

const Highlight = (() => {

  const WORDS = {
    c: {
      keyword: 'auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while _Atomic _Alignas _Alignof _Static_assert',
      type:    'char double float int long short signed unsigned void bool size_t ssize_t ptrdiff_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t intptr_t uintptr_t FILE va_list',
      literal: 'NULL true false',
    },
    cpp: {
      keyword: 'alignas alignof and asm auto break case catch class concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do dynamic_cast else enum explicit export extern for friend goto if inline mutable namespace new noexcept not operator or private protected public reinterpret_cast requires return sizeof static static_assert static_cast struct switch template this thread_local throw try typedef typeid typename union using virtual volatile while',
      type:    'bool char char8_t char16_t char32_t double float int long short signed unsigned void wchar_t size_t ssize_t ptrdiff_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t string string_view vector array map unordered_map set unordered_set deque list queue stack pair tuple optional variant span unique_ptr shared_ptr weak_ptr atomic mutex thread',
      literal: 'nullptr true false NULL',
    },
    rust: {
      keyword: 'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while',
      type:    'bool char f32 f64 i8 i16 i32 i64 i128 isize str u8 u16 u32 u64 u128 usize String Vec Box Option Result Some None Ok Err HashMap HashSet BTreeMap Rc Arc RefCell Cell Mutex RwLock',
      literal: 'true false',
    },
    python: {
      keyword: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case',
      type:    'int float str bytes bool list dict set tuple frozenset complex object type range enumerate zip map filter len print open sum min max abs sorted reversed',
      literal: 'None True False self',
    },
    js: {
      keyword: 'async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield',
      type:    'Array Object String Number Boolean Promise Map Set WeakMap WeakSet Symbol BigInt Math JSON Error TypeError RangeError Uint8Array Int32Array Float64Array ArrayBuffer DataView',
      literal: 'null undefined true false NaN Infinity',
    },
    verilog: {
      keyword: 'always always_comb always_ff always_latch assign begin case casex casez default else end endcase endfunction endmodule endtask for function generate genvar if initial input inout localparam module negedge output parameter posedge reg task wire logic typedef struct enum packed unique priority',
      type:    'bit byte int integer logic longint real reg shortint signed time unsigned wire',
      literal: '',
    },
    asm: { keyword: '', type: '', literal: '' },
    bash: {
      keyword: 'if then elif else fi for while until do done case esac function in select time coproc return break continue local export readonly declare typeset unset shift eval exec trap',
      type:    'echo printf cat grep sed awk cut sort uniq head tail wc find xargs tr ls cd rm mv cp mkdir chmod chown ps kill strace ltrace perf objdump readelf nm gdb make gcc g++ clang cargo rustc',
      literal: 'true false',
    },
  };

  const ALIASES = {
    'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', h: 'c',
    rs: 'rust', py: 'python', python3: 'python',
    javascript: 'js', mjs: 'js', node: 'js',
    sv: 'verilog', systemverilog: 'verilog', v: 'verilog',
    sh: 'bash', shell: 'bash', console: 'bash', zsh: 'bash',
    s: 'asm', nasm: 'asm', gas: 'asm', x86: 'asm', riscv: 'asm', arm: 'asm',
  };

  const set = s => new Set((s || '').split(/\s+/).filter(Boolean));

  /* Built once per language and cached: these alternations are long and
     rebuilding them per code block is wasted work on a page of twenty. */
  const cache = new Map();

  function rulesFor(lang) {
    if (cache.has(lang)) return cache.get(lang);
    const w = WORDS[lang] || { keyword: '', type: '', literal: '' };
    const words = { keyword: set(w.keyword), type: set(w.type), literal: set(w.literal) };

    /* Order is precedence. Comments and strings come first so that a keyword
       inside either is never coloured as code. */
    const parts = [];

    if (lang === 'python') {
      parts.push(String.raw`(?<str>"""[\s\S]*?"""|'''[\s\S]*?'''|(?:[rbfu]|rb|br|fr|rf)?"(?:[^"\\\n]|\\.)*"|(?:[rbfu]|rb|br|fr|rf)?'(?:[^'\\\n]|\\.)*')`);
      parts.push(String.raw`(?<comment>#[^\n]*)`);
      parts.push(String.raw`(?<decorator>@[A-Za-z_]\w*)`);
    } else if (lang === 'bash') {
      parts.push(String.raw`(?<comment>#[^\n]*)`);
      parts.push(String.raw`(?<str>"(?:[^"\\]|\\.)*"|'[^']*')`);
      parts.push(String.raw`(?<variable>\$\{[^}]*\}|\$\w+|\$[@*#?$!])`);
      parts.push(String.raw`(?<flag>(?<=\s)--?[A-Za-z][\w-]*)`);
    } else if (lang === 'asm') {
      parts.push(String.raw`(?<comment>[;#][^\n]*)`);
      parts.push(String.raw`(?<str>"(?:[^"\\]|\\.)*")`);
      parts.push(String.raw`(?<label>^[ \t]*[.\w$]+:)`);
      parts.push(String.raw`(?<directive>^[ \t]*\.[A-Za-z]\w*)`);
      parts.push(String.raw`(?<register>%\w+|\b(?:[re][abcd]x|[re][sd]i|[re][sb]p|r(?:8|9|1[0-5])[dwb]?|[abcd][lh]|x?mm\d+|[sw]?[pz]r?\d*)\b)`);
    } else {
      parts.push(String.raw`(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)`);
      parts.push(String.raw`(?<str>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|&quot;(?:(?!&quot;)[\s\S])*&quot;)`);
      if (lang === 'c' || lang === 'cpp') {
        /* A preprocessor line is taken whole: #include &lt;vector&gt; is one
           idea, and colouring "include" as a keyword and the header as an
           operator reads as noise. */
        parts.push(String.raw`(?<preproc>^[ \t]*#[ \t]*\w+[^\n]*)`);
      }
      if (lang === 'rust') {
        parts.push(String.raw`(?<attr>#!?\[[^\]]*\])`);
        parts.push(String.raw`(?<lifetime>&#39;[a-z_]\w*\b)`);
        parts.push(String.raw`(?<macro>\b[a-z_]\w*!)`);
      }
    }

    /* Numbers before identifiers, so 0x1f is one token rather than 0 and x1f. */
    parts.push(String.raw`(?<num>\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)(?:[uUlLfF]|u8|i32|i64|u32|u64|usize|isize|f32|f64)?\b)`);
    parts.push(String.raw`(?<word>\b[A-Za-z_]\w*\b)`);
    /* Escaped markup is skipped so &lt; is never split into & and lt. */
    parts.push(String.raw`(?<entity>&(?:amp|lt|gt|quot|#39);)`);

    const re = new RegExp(parts.join('|'), 'gm');
    const out = { re, words };
    cache.set(lang, out);
    return out;
  }

  /* `escaped` must already be HTML-escaped. Returns HTML with spans. */
  function run(escaped, langName) {
    const key = String(langName || '').toLowerCase();
    const lang = ALIASES[key] || key;
    if (!WORDS[lang]) return escaped;

    const { re, words } = rulesFor(lang);
    let out = '';
    let last = 0;
    let m;
    re.lastIndex = 0;

    while ((m = re.exec(escaped)) !== null) {
      const g = m.groups;
      out += escaped.slice(last, m.index);
      last = m.index + m[0].length;

      let cls = null;
      if (g.comment)        cls = 'hl-comment';
      else if (g.str)       cls = 'hl-string';
      else if (g.preproc)   cls = 'hl-preproc';
      else if (g.attr)      cls = 'hl-preproc';
      else if (g.decorator) cls = 'hl-preproc';
      else if (g.directive) cls = 'hl-preproc';
      else if (g.lifetime)  cls = 'hl-type';
      else if (g.macro)     cls = 'hl-fn';
      else if (g.label)     cls = 'hl-fn';
      else if (g.register)  cls = 'hl-type';
      else if (g.variable)  cls = 'hl-type';
      else if (g.flag)      cls = 'hl-num';
      else if (g.num)       cls = 'hl-num';
      else if (g.word) {
        const t = g.word;
        if (words.keyword.has(t))      cls = 'hl-keyword';
        else if (words.type.has(t))    cls = 'hl-type';
        else if (words.literal.has(t)) cls = 'hl-literal';
        /* A name immediately followed by "(" is being called or declared,
           which is worth seeing even when we cannot know which. */
        else if (escaped[last] === '(') cls = 'hl-fn';
      }
      /* entity and anything unclassified pass through untouched. */

      out += cls ? `<span class="${cls}">${m[0]}</span>` : m[0];
    }

    return out + escaped.slice(last);
  }

  const supports = langName => {
    const key = String(langName || '').toLowerCase();
    return !!WORDS[ALIASES[key] || key];
  };

  return { run, supports, ALIASES, WORDS };
})();
