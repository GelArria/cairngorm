// Column offsets for a virtualized grid: rows have one height, columns their own widths.
export const ROW_HEIGHT = 26;
const DEFAULT_WIDTH = 88;
export class Columns {
    constructor(count, widths) {
        this.count = count;
        this.offsets = new Float64Array(count + 1);
        for (let col = 0; col < count; col++) {
            this.offsets[col + 1] = this.offsets[col] + (widths.get(col) ?? DEFAULT_WIDTH);
        }
    }
    left(col) {
        return this.offsets[col];
    }
    width(col) {
        return this.offsets[col + 1] - this.offsets[col];
    }
    get total() {
        return this.offsets[this.count];
    }
    /** The column containing horizontal position `x`. */
    at(x) {
        let low = 0;
        let high = this.count - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (this.offsets[mid] <= x) {
                low = mid;
            }
            else {
                high = mid - 1;
            }
        }
        return low;
    }
}
/** Grid extent: the data plus room to keep typing, within Excel's limits. */
export function extent(rows, cols) {
    return {
        rows: Math.min(1048576, Math.max(rows + 50, 100)),
        cols: Math.min(16384, Math.max(cols + 8, 26)),
    };
}
