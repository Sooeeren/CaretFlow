// Syntax colors for code, shared by the editor's code blocks, source mode and HTML/PDF export so
// they all look the same. The colors are CSS variables (--tok-*, per theme in style.css); export.js
// copies the export theme's values into the exported file.
import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

export const TOKEN_VARS = ['--tok-keyword', '--tok-string', '--tok-number', '--tok-comment', '--tok-function', '--tok-type', '--tok-property', '--tok-tag', '--tok-operator', '--tok-meta', '--tok-invalid']

export const codeStyle = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.self], color: 'var(--tok-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.inserted], color: 'var(--tok-string)' },
  { tag: [t.number, t.bool, t.atom, t.null, t.unit, t.color, t.constant(t.name), t.standard(t.name)], color: 'var(--tok-number)' },
  { tag: t.comment, color: 'var(--tok-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.labelName], color: 'var(--tok-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--tok-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--tok-property)' },
  { tag: [t.tagName, t.deleted, t.heading], color: 'var(--tok-tag)' },
  { tag: [t.operator, t.derefOperator, t.escape], color: 'var(--tok-operator)' },
  { tag: [t.meta, t.processingInstruction, t.annotation], color: 'var(--tok-meta)' },
  { tag: t.invalid, color: 'var(--tok-invalid)' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, textDecoration: 'underline' },
])
