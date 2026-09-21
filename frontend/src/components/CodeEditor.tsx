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
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import './CodeEditor.css';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'yaml' | 'env';
  placeholder?: string;
  height?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
}

const yamlLanguage = StreamLanguage.define(yaml);
// .env files are KEY=value lines; the properties mode highlights those.
const envLanguage = StreamLanguage.define(properties);

const giscoTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: '#e2e8f0',
    fontSize: '0.85rem',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
    caretColor: 'var(--primary)',
    padding: '16px 0',
  },
  '.cm-cursor': { borderLeftColor: 'var(--primary)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: '1px solid var(--border-subtle)',
    color: 'var(--text-dim)',
  },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-placeholder': { color: 'var(--text-dim)' },
});

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  onChange,
  language = 'yaml',
  placeholder = '',
  height = '300px',
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
        syntaxHighlighting(defaultHighlightStyle),
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

  return <div ref={containerRef} className="cm-editor" style={{ height }} />;
};

export default CodeEditor;
