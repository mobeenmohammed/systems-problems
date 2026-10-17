/* The entry point for the vendored CodeMirror bundle.

   Only what the site actually uses is pulled in, so the bundle is the size of
   the feature set rather than the size of the library. Deliberately NOT
   included: the search panel, code folding, rectangular selection, and
   tooltips.

   Autocompletion used to be on that list. It is in now, because C++ without
   it is a worse place to write C++ than anywhere else these problems might
   be attempted. The word lists live in js/complete-cpp.js rather than here,
   so changing them does not mean rebuilding this bundle; Python and
   JavaScript get the completions their language packages already provide.

   Built once by scripts/build-editor.mjs into vendor/codemirror.js and
   committed. The site itself still has no build step and no runtime
   dependency on npm.

   Everything is hung off one global because the site loads plain <script>
   tags in dependency order, with no module loader. */

import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, drawSelection, dropCursor,
} from '@codemirror/view';
import {
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo,
} from '@codemirror/commands';
import {
  syntaxHighlighting, HighlightStyle, indentUnit, bracketMatching, StreamLanguage,
} from '@codemirror/language';
import {
  closeBrackets, closeBracketsKeymap,
  autocompletion, completionKeymap, startCompletion,
} from '@codemirror/autocomplete';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { tags } from '@lezer/highlight';

import { cpp } from '@codemirror/lang-cpp';
import { rust } from '@codemirror/lang-rust';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
/* SystemVerilog has no Lezer grammar. The CodeMirror 5 Verilog mode does
   exist, knows the 2012 keyword set, and runs under StreamLanguage —
   which tokenises by line rather than by parse tree, so there is no
   syntax-aware indentation or folding from it. What there is, is
   keywords, numbers, strings and comments told apart correctly, which
   is the whole of what the designs here need and strictly better than
   the plain text the hardware editor used to show. C-like highlighting
   was the wrong answer: `logic` is not a C type and `always_ff` is not
   a C keyword. */
import { verilog } from '@codemirror/legacy-modes/mode/verilog';

/* Every colour comes from the page's own tokens, so a purchased theme
   repaints the editor with it and tests/contrast.test.mjs still governs
   whether a comment is readable. */
const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.moduleKeyword], color: 'var(--hl-keyword)' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.typeName)], color: 'var(--hl-type)' },
  { tag: [tags.string, tags.special(tags.string), tags.character], color: 'var(--hl-string)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--hl-num)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName], color: 'var(--hl-fn)' },
  { tag: [tags.bool, tags.null, tags.atom, tags.literal, tags.self], color: 'var(--hl-literal)' },
  { tag: [tags.processingInstruction, tags.meta, tags.annotation], color: 'var(--hl-preproc)' },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket, tags.paren, tags.brace], color: 'var(--text-dim)' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName, tags.definition(tags.variableName)], color: 'var(--text)' },
  { tag: tags.invalid, color: 'var(--danger)' },
]);

const systemverilog = () => StreamLanguage.define(verilog);

const LANGUAGES = {
  cpp, rust, python, javascript, js: javascript,
  /* Three names for it: the problem data says `sv`, the HDL workspace
     asks for `verilog`, and `systemverilog` is what somebody would
     guess. All three land on the same mode. */
  verilog: systemverilog, sv: systemverilog, systemverilog,
};

export default {
  EditorState, EditorView, Compartment,
  keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, drawSelection, dropCursor,
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo,
  syntaxHighlighting, indentUnit, bracketMatching,
  closeBrackets, closeBracketsKeymap,
  autocompletion, completionKeymap, startCompletion,
  lintGutter, setDiagnostics,
  highlightStyle, LANGUAGES,
};
