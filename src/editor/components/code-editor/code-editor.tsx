import { indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import {
  findNext,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { placeholder as cmPlaceholder, EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "preact/hooks";
import { editorTheme, panelHighlight } from "./editor-theme";
import { loadLanguage } from "./languages";
import { alwaysHighlightSearch } from "./search-decorations";

export interface CodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  language: string;
  filename?: string;
  readOnly?: boolean;
  placeholder?: string;
  highlightLine?: number;
  highlightText?: string;
  highlightKey?: number;
}

export function CodeEditor({
  value,
  onChange,
  language,
  filename,
  readOnly,
  placeholder,
  highlightLine,
  highlightText,
  highlightKey,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const skipSyncRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compartmentsRef = useRef({ lang: new Compartment(), readOnly: new Compartment() });
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        syntaxHighlighting(panelHighlight),
        editorTheme,
        keymap.of([indentWithTab]),
        highlightSelectionMatches(),
        search({ top: true }),
        alwaysHighlightSearch,
        Prec.highest(keymap.of([{ key: "Mod-h", run: openSearchPanel }])),
        compartmentsRef.current.lang.of([]),
        compartmentsRef.current.readOnly.of(EditorState.readOnly.of(!!readOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            skipSyncRef.current = true;
            // Debounce full-doc toString() calls for large documents
            const docLen = update.state.doc.length;
            const delay = docLen > 200_000 ? 400 : docLen > 50_000 ? 200 : 0;
            if (debounceRef.current) {
              clearTimeout(debounceRef.current);
            }
            if (delay === 0) {
              onChangeRef.current(update.state.doc.toString());
            } else {
              debounceRef.current = setTimeout(() => {
                const v = viewRef.current;
                if (v) {
                  onChangeRef.current(v.state.doc.toString());
                }
              }, delay);
            }
          }
        }),
        ...(placeholder ? [cmPlaceholder(placeholder)] : []),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const doc = view.state.doc;
    // Quick length check first — avoids toString() for identical content
    if (doc.length === value.length && doc.sliceString(0) === value) {
      return;
    }
    // For large docs, use chunked diff to avoid freezing
    if (value.length > 100_000) {
      const currentStr = doc.sliceString(0);
      // Find first difference
      let start = 0;
      const minLen = Math.min(currentStr.length, value.length);
      while (start < minLen && currentStr[start] === value[start]) {
        start++;
      }
      // Find last difference
      let endOld = currentStr.length;
      let endNew = value.length;
      while (endOld > start && endNew > start && currentStr[endOld - 1] === value[endNew - 1]) {
        endOld--;
        endNew--;
      }
      if (start < endOld || start < endNew) {
        view.dispatch({ changes: { from: start, to: endOld, insert: value.slice(start, endNew) } });
      }
    } else {
      view.dispatch({ changes: { from: 0, to: doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    let active = true;
    view.dispatch({ effects: compartmentsRef.current.lang.reconfigure([]) });
    loadLanguage(language, filename)
      .then((support) => {
        if (active && viewRef.current === view) {
          view.dispatch({ effects: compartmentsRef.current.lang.reconfigure(support ?? []) });
        }
      })
      .catch((error) => {
        if (active) {
          console.warn("Could not load syntax highlighting", filename ?? language, error);
        }
      });
    return () => {
      active = false;
    };
  }, [language, filename]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: compartmentsRef.current.readOnly.reconfigure(EditorState.readOnly.of(!!readOnly)),
    });
  }, [readOnly]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Scroll to line + highlight search pattern when triggered from search results
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const apply = () => {
      const v = viewRef.current;
      if (!v) {
        return;
      }

      // Scroll to specific line if provided
      if (highlightLine) {
        const ln = Math.min(highlightLine, v.state.doc.lines);
        if (ln >= 1) {
          const lineInfo = v.state.doc.line(ln);
          v.dispatch({ effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }) });
        }
      }

      // Highlight all matches of the search pattern in the file
      if (highlightText) {
        try {
          const sq = new SearchQuery({ search: highlightText, caseSensitive: false });
          v.dispatch({ effects: setSearchQuery.of(sq) });
          requestAnimationFrame(() => {
            try {
              findNext(v);
            } catch {}
          });
        } catch {}
      }
    };

    // Double-rAF ensures CodeMirror has finished rendering after content load
    requestAnimationFrame(() => requestAnimationFrame(apply));
  }, [highlightLine, highlightText, highlightKey]);

  return (
    <div
      ref={containerRef}
      class="h-full w-full overflow-hidden rounded border border-border"
      data-testid="code-editor"
    >
      <style>{`.cm-searchMatch span { background: inherit !important; color: inherit !important; }`}</style>
    </div>
  );
}
