# Markdown reading

Tables and mixed formatting, with the original structure preserved.

## Aligned tables

| File              |      Status      | Detail |
| :---------------- | :--------------: | -----: |
| **README.md**     |    _Reviewed_    |     42 |
| `src/app/main.ts` | ~~Pending~~ Done |      7 |
| Path `a\|b`       |   **Correct**    |    100 |

## Formatting and characters

**_Bold + italic_** · ~~Strikethrough~~ · \*Literal asterisks\* · `**literal code**`

> Tables, lists, and code preserve their own characters.
> A `|` inside text does not split a cell when escaped as `\|`.

1. Review the document
   - Check the nested list
2. Open [the documentation](<https://example.com/docs_(markdown)>)

- [x] Readable table
- [ ] Next review

## Literal code

```ts
const example = "**text** | <tag>";
console.log(example);
```

---

More information at <https://example.com>.
