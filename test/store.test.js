import { test, expect } from "bun:test";
import {
    parseStore,
    serializeStore,
    addEntry,
    toggleDone,
    removeEntry,
    displayRows,
    dayLabel,
} from "../src/store.js";

const SAMPLE = `## 2026-09-18
- [ ] first
- [x] done one

## 2026-09-19
- [ ] multi line
  second line

  after blank
- [ ] last
`;

// --- parse / serialize -------------------------------------------------------

test("parses days, entries, done state and continuation lines", () => {
    const blocks = parseStore(SAMPLE);
    expect(blocks).toEqual([
        { type: "day", date: "2026-09-18" },
        { type: "entry", date: "2026-09-18", text: "first", done: false },
        { type: "entry", date: "2026-09-18", text: "done one", done: true },
        { type: "other", raw: "" },
        { type: "day", date: "2026-09-19" },
        {
            type: "entry",
            date: "2026-09-19",
            text: "multi line\nsecond line\n\nafter blank",
            done: false,
        },
        { type: "entry", date: "2026-09-19", text: "last", done: false },
    ]);
});

test("round-trips the sample byte for byte", () => {
    expect(serializeStore(parseStore(SAMPLE))).toBe(SAMPLE);
});

test("keeps foreign lines verbatim, including items outside any day", () => {
    const text = `# My inbox
- [ ] not under a day

## 2026-09-19
Some prose here.
- [ ] real entry
> a quote
`;
    const blocks = parseStore(text);
    expect(blocks[0]).toEqual({ type: "other", raw: "# My inbox" });
    expect(blocks[1]).toEqual({ type: "other", raw: "- [ ] not under a day" });
    expect(blocks.filter((b) => b.type === "entry")).toHaveLength(1);
    expect(serializeStore(blocks)).toBe(text);
});

test("empty and missing files parse to no blocks and serialize to empty", () => {
    expect(parseStore("")).toEqual([]);
    expect(parseStore(undefined)).toEqual([]);
    expect(serializeStore([])).toBe("");
});

test("a trailing blank line after an entry is not part of the entry", () => {
    const blocks = parseStore("## 2026-09-19\n- [ ] a\n\n\n## 2026-09-20\n- [ ] b\n");
    expect(blocks[1].text).toBe("a");
    expect(blocks[2]).toEqual({ type: "other", raw: "" });
    expect(blocks[3]).toEqual({ type: "other", raw: "" });
});

test("serializer inserts one blank line before a day heading that lacks one", () => {
    const blocks = [
        { type: "day", date: "2026-09-18" },
        { type: "entry", date: "2026-09-18", text: "a", done: false },
        { type: "day", date: "2026-09-19" },
        { type: "entry", date: "2026-09-19", text: "b", done: true },
    ];
    expect(serializeStore(blocks)).toBe("## 2026-09-18\n- [ ] a\n\n## 2026-09-19\n- [x] b\n");
});

test("accepts a capital X as done and tolerates CRLF", () => {
    const blocks = parseStore("## 2026-09-19\r\n- [X] a\r\n");
    expect(blocks[1]).toEqual({ type: "entry", date: "2026-09-19", text: "a", done: true });
});

// --- mutations ---------------------------------------------------------------

test("addEntry appends to an existing day after its last entry", () => {
    const blocks = parseStore("## 2026-09-19\n- [ ] a\n\nfoot note\n");
    const out = serializeStore(addEntry(blocks, "2026-09-19", "b"));
    expect(out).toBe("## 2026-09-19\n- [ ] a\n- [ ] b\n\nfoot note\n");
});

test("addEntry creates a new day at the end when the date is new", () => {
    const blocks = parseStore("## 2026-09-18\n- [ ] a\n");
    const out = serializeStore(addEntry(blocks, "2026-09-19", "b"));
    expect(out).toBe("## 2026-09-18\n- [ ] a\n\n## 2026-09-19\n- [ ] b\n");
});

test("addEntry keeps days ascending when a later day already exists", () => {
    const blocks = parseStore("## 2026-09-18\n- [ ] a\n\n## 2026-09-20\n- [ ] c\n");
    const out = serializeStore(addEntry(blocks, "2026-09-19", "b"));
    expect(out).toBe(
        "## 2026-09-18\n- [ ] a\n\n## 2026-09-19\n- [ ] b\n\n## 2026-09-20\n- [ ] c\n",
    );
});

test("addEntry trims, normalises CRLF, and ignores blank text", () => {
    expect(addEntry([], "2026-09-19", "  \n\t")).toEqual([]);
    const out = serializeStore(addEntry([], "2026-09-19", "  hi\r\n  there  \n\n"));
    expect(out).toBe("## 2026-09-19\n- [ ] hi\n    there\n");
});

test("toggleDone flips only the addressed entry", () => {
    const blocks = parseStore("## 2026-09-19\n- [ ] a\n- [ ] b\n");
    expect(serializeStore(toggleDone(toggleDone(blocks, 2), 2))).toBe(
        "## 2026-09-19\n- [ ] a\n- [ ] b\n",
    );
    expect(serializeStore(toggleDone(blocks, 1))).toBe("## 2026-09-19\n- [x] a\n- [ ] b\n");
    expect(serializeStore(toggleDone(blocks, 0))).toBe("## 2026-09-19\n- [ ] a\n- [ ] b\n");
});

test("removeEntry drops the entry, and the day when it was the last one", () => {
    const blocks = parseStore("## 2026-09-18\n- [ ] a\n\n## 2026-09-19\n- [ ] b\n- [ ] c\n");
    expect(serializeStore(removeEntry(blocks, 4))).toBe(
        "## 2026-09-18\n- [ ] a\n\n## 2026-09-19\n- [ ] c\n",
    );
    expect(serializeStore(removeEntry(blocks, 1))).toBe("## 2026-09-19\n- [ ] b\n- [ ] c\n");
});

test("removeEntry leaves foreign lines of an emptied day in place", () => {
    const blocks = parseStore("## 2026-09-19\n- [ ] a\nkeep me\n");
    expect(serializeStore(removeEntry(blocks, 1))).toBe("keep me\n");
});

test("mutations do not touch their input", () => {
    const blocks = parseStore("## 2026-09-19\n- [ ] a\n");
    const copy = JSON.parse(JSON.stringify(blocks));
    addEntry(blocks, "2026-09-19", "b");
    toggleDone(blocks, 1);
    removeEntry(blocks, 1);
    expect(blocks).toEqual(copy);
});

// --- display -----------------------------------------------------------------

test("displayRows: newest day first, newest entry first, done entries sink within their day", () => {
    const blocks = parseStore(
        "## 2026-09-18\n- [x] old done\n- [ ] old open\n\n## 2026-09-19\n- [ ] a\n- [x] b\n- [ ] c\n",
    );
    expect(displayRows(blocks).map((r) => r.text)).toEqual(["c", "a", "b", "old open", "old done"]);
    expect(displayRows(blocks)[0]).toEqual({
        index: 7,
        date: "2026-09-19",
        text: "c",
        done: false,
    });
});

test("displayRows merges duplicate day headings for the same date", () => {
    const blocks = parseStore("## 2026-09-19\n- [ ] a\n\n## 2026-09-19\n- [ ] b\n");
    expect(displayRows(blocks).map((r) => r.text)).toEqual(["b", "a"]);
});

test("dayLabel names today and yesterday, else the date", () => {
    expect(dayLabel("2026-09-19", "2026-09-19")).toBe("Today");
    expect(dayLabel("2026-09-18", "2026-09-19")).toBe("Yesterday");
    expect(dayLabel("2026-08-31", "2026-09-01")).toBe("Yesterday");
    expect(dayLabel("2026-09-17", "2026-09-19")).toBe("2026-09-17");
    expect(dayLabel("2026-09-20", "2026-09-19")).toBe("2026-09-20");
});
