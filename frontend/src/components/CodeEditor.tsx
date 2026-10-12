import React, { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  StreamLanguage,
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { searchKeymap } from '@codemirror/search';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import './CodeEditor.css';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'yaml' | 'env';
  placeholder?: string;
  /** Fixed height (e.g. '300px'), or 'auto' to grow with content. */
  height?: string;
  /** Cap for 'auto' mode (e.g. '75vh'); the editor scrolls past it. */
  maxHeight?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
}

const yamlLanguage = StreamLanguage.define(yaml);
// .env files are KEY=value lines; the properties mode highlights those.
// It emits values as "quote" (unstyleable custom tag), so remap to "string".
const envLanguage = StreamLanguage.define({
  ...properties,
  token(stream: any, state: any) {
    const style = (properties as any).token(stream, state);
    return style === 'quote' ? 'string' : style;
  },
});

// Pastel-on-dark palette: bright enough to read against the editor
// background in both yaml and env modes. Colours are semantic tokens, so the
// editor follows the app theme. CodeMirror injects these as real CSS, so
// `var()` resolves and nothing has to be reconfigured when the theme changes.
const pastelHighlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--syntax-comment)' },
  { tag: t.keyword, color: 'var(--syntax-keyword)' },
  { tag: [t.atom, t.number, t.bool, t.unit], color: 'var(--syntax-number)' },
  { tag: t.string, color: 'var(--syntax-string)' },
  { tag: [t.variableName, t.propertyName, t.attributeName], color: 'var(--syntax-variable)' },
  { tag: t.definition(t.variableName), color: 'var(--syntax-definition)', fontWeight: '600' },
  { tag: [t.meta, t.documentMeta], color: 'var(--syntax-meta)' },
  { tag: [t.punctuation, t.operator, t.separator], color: 'var(--syntax-punctuation)' },
  { tag: t.heading, color: 'var(--syntax-heading)', fontWeight: '600' },
  { tag: t.invalid, color: 'var(--syntax-invalid)' },
]);

const giscoTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--editor-foreground)',
    fontSize: '0.85rem',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
    caretColor: 'var(--editor-caret)',
    padding: 'var(--space-16) 0',
  },
  '.cm-cursor': { borderLeftColor: 'var(--editor-caret)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: 'var(--border-width) solid var(--border-subtle)',
    color: 'var(--text-dim)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-placeholder': { color: 'var(--text-dim)' },
});

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  onChange,
  language = 'yaml',
  placeholder = '',
  height = '300px',
  maxHeight = '75vh',
  readOnly = false,
  autoFocus = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const languageConf = useRef(new Compartment());
  const readOnlyConf = useRef(new Compartment());

  onChangeRef.current = onChange;

  // Mount once; prop updates flow through the effects below.
  useEffect(() => {
    if (!containerRef.current) return;

    const startState = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        bracketMatching(),
        history(),
        indentOnInput(),
        syntaxHighlighting(pastelHighlight),
        giscoTheme,
        languageConf.current.of(language === 'env' ? envLanguage : yamlLanguage),
        readOnlyConf.current.of(EditorState.readOnly.of(readOnly)),
        cmPlaceholder(placeholder),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state: startState, parent: containerRef.current });
    viewRef.current = view;
    if (autoFocus) view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value updates (e.g. switching stacks) replace the doc.
  useEffect(() => {
    const view = viewRef.current;
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  // Language / readOnly toggles reconfigure in place.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: languageConf.current.reconfigure(language === 'env' ? envLanguage : yamlLanguage),
    });
  }, [language]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyConf.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  return (
    <div
      ref={containerRef}
      className="cm-editor"
      style={
        height === 'auto'
          ? { height: 'auto', maxHeight, overflowY: 'auto' }
          : { height }
      }
    />
  );
};

export default CodeEditor;
