import { getSearchQuery, setSearchQuery } from "@codemirror/search";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

const matchMark = Decoration.mark({ class: "cm-searchMatch" });
const selectedMatchMark = Decoration.mark({ class: "cm-searchMatch cm-searchMatch-selected" });

export const alwaysHighlightSearch = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(readonly view: EditorView) {
      this.decorations = this.build();
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.transactions.some((tr: any) => tr.effects.some((e: any) => e.is(setSearchQuery)))
      ) {
        this.decorations = this.build();
      }
    }

    build(): DecorationSet {
      const q = getSearchQuery(this.view.state);
      if (!q.search || !q.valid) {
        return Decoration.none;
      }
      try {
        const builder = new RangeSetBuilder<Decoration>();
        const sels = this.view.state.selection.ranges;
        for (const { from, to } of this.view.visibleRanges) {
          const cursor = q.getCursor(
            this.view.state,
            Math.max(0, from - 250),
            Math.min(this.view.state.doc.length, to + 250),
          );
          while (!cursor.next().done) {
            const mFrom = (cursor as any).value.from as number;
            const mTo = (cursor as any).value.to as number;
            const isSel = sels.some((r) => r.from === mFrom && r.to === mTo);
            builder.add(mFrom, mTo, isSel ? selectedMatchMark : matchMark);
          }
        }
        return builder.finish();
      } catch {
        return Decoration.none;
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
