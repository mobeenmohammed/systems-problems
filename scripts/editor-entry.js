/* The entry point for the vendored CodeMirror bundle.

   Only what the site actually uses is pulled in, so the bundle is the size of
   the feature set rather than the size of the library. Deliberately NOT
   included: autocompletion and the search panel (nothing here wants either,
   and together they are a third of the weight), code folding, rectangular
   selection, and tooltips.

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
  syntaxHighlighting, HighlightStyle, indentUnit, bracketMatching,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { tags } from '@lezer/highlight';

import { cpp } from '@codemirror/lang-cpp';
import { rust } from '@codemirror/lang-rust';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';

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

const LANGUAGES = { cpp, rust, python, javascript, js: javascript };

export default {
  EditorState, EditorView, Compartment,
  keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, drawSelection, dropCursor,
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo,
  syntaxHighlighting, indentUnit, bracketMatching,
  closeBrackets, closeBracketsKeymap,
  lintGutter, setDiagnostics,
  highlightStyle, LANGUAGES,
};
