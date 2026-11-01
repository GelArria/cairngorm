// The `.sample` format: an optional `# Title`, `key = value` fields, and paragraphs.
export function parseSample(text) {
    const sample = { title: "", fields: [], paragraphs: [] };
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) {
            continue;
        }
        const separator = line.indexOf("=");
        if (line.startsWith("# ") && !sample.title) {
            sample.title = line.slice(2).trim();
        }
        else if (separator > 0) {
            sample.fields.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()]);
        }
        else {
            sample.paragraphs.push(line);
        }
    }
    return sample;
}
/** Field values stay on one line, so a saved document parses back to the same fields. */
export function serializeSample(sample) {
    const lines = [];
    if (sample.title) {
        lines.push(`# ${sample.title}`);
    }
    for (const [key, value] of sample.fields) {
        lines.push(`${key} = ${value.replace(/[\r\n]+/g, " ")}`);
    }
    lines.push(...sample.paragraphs);
    return `${lines.join("\n")}\n`;
}
