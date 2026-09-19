# Omacopper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Omarchy 4 shell plugin that opens a quick-capture Panel on a hotkey, prefilled from the primary selection, stores Entries in one markdown file, and copies any Entry back to the clipboard.

**Architecture:** One Quattro plugin of kind `panel` (`keepLoaded`) rendered as a layer-shell modal card in the style of the first-party clipboard plugin. All logic with edge cases (Store parsing/serialising, display ordering, config lookup) lives in plain JavaScript under `src/`, loaded both by QML (`import "src/store.js" as Store`) and by `bun test`. `Panel.qml` is thin glue: FileView for the Store, a `wl-paste -p` Process for prefill, `wl-copy` for Copy-back.

**Tech Stack:** Quickshell 0.3.1 QML (Qt 6.11), plain ES2020-compatible JS (no modules: QML `.js` imports have none), bun test, eslint 10, prettier 3, husky + lint-staged, commitlint, release-please.

**Spec:** `CONTEXT.md` (glossary), `docs/adr/0001-markdown-diary-as-store.md`, and the grilling decisions summarised below.

## Global Constraints

- Plugin id `scoop.omacopper`, name "Omacopper", MIT, author `scoop`.
- Manifest `kinds: ["panel"]`, `entryPoints.panel: "Panel.qml"`, `keepLoaded: true`.
- No symlinks anywhere in the repo (installer refuses them).
- `src/*.js` must run inside QML's JS engine: `var`, functions, no `export`/`import`, no optional catch binding; end with the `if (typeof module !== "undefined") module.exports = {...}` guard.
- Prettier: `printWidth: 100`, `tabWidth: 4`. Conventional commits.
- Store default path `~/.local/share/omacopper/entries.md`; override via `storePath` on the plugin's entry in `~/.config/omarchy/shell.json` (`plugins[]`). The shell does **not** inject settings into panel plugins, so the plugin reads `shell.json` itself.
- Store format: `## YYYY-MM-DD` Day headings; `- [ ] text` / `- [x] text`; continuation lines indented two spaces; blank lines inside an Entry allowed when followed by a continuation line. Foreign non-blank lines preserved verbatim. One blank line before each Day heading. Entries before any Day heading are foreign lines.
- Keyboard: editor `Enter` = Capture, `Shift+Enter` = newline, `Esc` = close, `Tab` or `↓` on empty editor = list. List `↑/↓` `j/k` move, `↑` past top = editor, `Space` = toggle Done, `Enter` = Copy-back + close, `Delete` = remove (no confirm), `Tab` = editor, printable = editor with that char.
- Display: newest Day first, newest Entry first within a Day, Done Entries after open ones within their Day. Display-only; file order untouched.
- Copy-back: `wl-copy -- <text>`, raw text, then close.
- Dev loop: repo lives at `~/Work/omacopper`; test copy is synced with
  `rsync -a --delete --exclude .git --exclude node_modules ~/Work/omacopper/ ~/.config/omarchy/plugins/scoop.omacopper/`
  then `omarchy-shell shell rescanPlugins` (first time also `omarchy plugin enable scoop.omacopper`).

---

## File Structure

| File                                                                                                                                                        | Responsibility                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `manifest.json`                                                                                                                                             | Plugin identity and entry point                                                                                    |
| `Panel.qml`                                                                                                                                                 | The Panel: layer-shell window, editor, list, key handling, FileView/Process glue                                   |
| `src/store.js`                                                                                                                                              | Pure functions: `parseStore`, `serializeStore`, `addEntry`, `toggleDone`, `removeEntry`, `displayRows`, `dayLabel` |
| `src/config.js`                                                                                                                                             | Pure functions: `defaultStorePath`, `storePathFrom`, `dirname`                                                     |
| `src/qml.d.ts`                                                                                                                                              | Declares `module` for typecheck                                                                                    |
| `test/store.test.js`, `test/config.test.js`                                                                                                                 | bun tests                                                                                                          |
| `package.json`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`, `commitlint.config.js`, `.husky/*`, `.gitignore`                                        | Tooling                                                                                                            |
| `.github/workflows/ci.yml`, `.github/workflows/release-please.yml`, `.github/dependabot.yml`, `release-please-config.json`, `.release-please-manifest.json` | CI and releases                                                                                                    |
| `README.md`, `LICENSE`                                                                                                                                      | Docs                                                                                                               |

---

### Task 1: Repo skeleton and tooling

**Files:**

- Create: `package.json`, `eslint.config.js`, `tsconfig.json`, `.prettierrc`, `commitlint.config.js`, `.gitignore`, `.husky/commit-msg`, `.husky/pre-commit`, `.husky/pre-push`, `LICENSE`, `src/qml.d.ts`, `manifest.json`

**Interfaces:**

- Produces: `bun test`, `bun run lint`, `bun run typecheck`, `bunx prettier --check .` all runnable.

- [ ] **Step 1: package.json**

```json
{
    "name": "omarchy-plugin-omacopper",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
        "test": "bun test",
        "lint": "eslint .",
        "format": "prettier --write .",
        "prepare": "husky",
        "typecheck": "tsc --noEmit"
    },
    "devDependencies": {
        "@commitlint/cli": "^21.2.2",
        "@commitlint/config-conventional": "^21.2.2",
        "@eslint/js": "^10.0.1",
        "eslint": "^10.10.0",
        "husky": "^9.1.7",
        "lint-staged": "^17.5.1",
        "prettier": "^3.4.2",
        "typescript": "^7.0.2"
    },
    "lint-staged": {
        "*.{js,json,md,yml}": "prettier --write",
        "*.js": "eslint"
    }
}
```

- [ ] **Step 2: eslint.config.js**

```js
import js from "@eslint/js";

export default [
    js.configs.recommended,
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: { console: "readonly", module: "writable" },
        },
        rules: {
            // src/ also runs in QML's JavaScript engine, where optional catch
            // binding support is unverified; a named, unread binding is the
            // portable form.
            "no-unused-vars": ["error", { caughtErrors: "none" }],
        },
    },
    {
        files: ["test/**/*.js"],
        languageOptions: {
            globals: { Bun: "readonly", process: "readonly" },
        },
    },
];
```

- [ ] **Step 3: tsconfig.json, .prettierrc, commitlint.config.js, .gitignore, src/qml.d.ts**

tsconfig.json:

```json
{
    "compilerOptions": {
        "target": "ES2020",
        "lib": ["ES2020"],
        "module": "preserve",
        "moduleResolution": "bundler",
        "allowJs": true,
        "checkJs": true,
        "noEmit": true,
        "strict": false,
        "types": []
    },
    "include": ["src/**/*.js", "src/**/*.d.ts"]
}
```

.prettierrc: `{ "printWidth": 100, "tabWidth": 4 }`
commitlint.config.js: `export default { extends: ["@commitlint/config-conventional"] };`
.gitignore: `node_modules/` and `*.log`.
src/qml.d.ts:

```ts
// QML loads these files as plain scripts with no module system. The trailing
// module.exports guard exists only for the test runner, so `module` is
// declared here rather than by pulling in Node typings.
declare var module: { exports: unknown } | undefined;
```

- [ ] **Step 4: husky hooks**

`.husky/commit-msg`: `bunx commitlint --edit "$1"`
`.husky/pre-commit`: `bunx lint-staged`
`.husky/pre-push`:

```sh
bun test
bunx eslint .
bunx prettier --check .
bun run typecheck
```

- [ ] **Step 5: LICENSE** (MIT, "Copyright (c) 2026 Patrick Lenz") and **manifest.json**:

```json
{
    "schemaVersion": 1,
    "id": "scoop.omacopper",
    "name": "Omacopper",
    "version": "0.1.0",
    "author": "scoop",
    "description": "Quick-capture scratch list: one hotkey, one panel, one markdown file. Capture the selection, check it off, copy it back.",
    "license": "MIT",
    "kinds": ["panel"],
    "keepLoaded": true,
    "entryPoints": { "panel": "Panel.qml" }
}
```

- [ ] **Step 6: Install and verify**

Run: `bun install && bunx prettier --write . && bun run lint && bun run typecheck`
Expected: exit 0 (no tests yet: `bun test` reports 0 files, exit 0 is acceptable at this task).

- [ ] **Step 7: Commit** `chore: scaffold plugin skeleton and tooling`

---

### Task 2: Store parser and serializer

**Files:**

- Create: `src/store.js`, `test/store.test.js`

**Interfaces:**

- Produces: `parseStore(text: string): Block[]` where `Block = {type:"day", date} | {type:"entry", date, text, done} | {type:"other", raw}`; `serializeStore(blocks): string`.

- [ ] **Step 1: Failing tests**

```js
import { test, expect } from "bun:test";
import { parseStore, serializeStore } from "../src/store.js";

const SAMPLE = `## 2026-09-18
- [ ] first
- [x] done one

## 2026-09-19
- [ ] multi line
  second line

  after blank
- [ ] last
`;

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
    expect(serializeStore([])).toBe("");
});

test("a trailing blank line after an entry is not part of the entry", () => {
    const blocks = parseStore("## 2026-09-19\n- [ ] a\n\n\n## 2026-09-20\n- [ ] b\n");
    expect(blocks[1].text).toBe("a");
    expect(blocks[2]).toEqual({ type: "other", raw: "" });
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
```

- [ ] **Step 2: Run** `bun test test/store.test.js` — Expected: FAIL, cannot resolve `../src/store.js`.

- [ ] **Step 3: Implement**

```js
// The Store: one markdown file, parsed into blocks and written back. Pure
// functions only — no QML, no I/O — so the test runner and the shell load the
// same file. Vocabulary is CONTEXT.md's: Day, Entry, Done, Store.

var DAY_RE = /^## (\d{4}-\d{2}-\d{2})\s*$/;
var ENTRY_RE = /^- \[( |x|X)\] ?(.*)$/;
var CONT_RE = /^  (.*)$/;

/**
 * Parse Store text into blocks. Entries outside a Day, and any line the app
 * does not own, become `other` blocks kept verbatim.
 * @param {string} text
 * @returns {Array<object>}
 */
function parseStore(text) {
    var lines = String(text || "")
        .replace(/\r\n?/g, "\n")
        .split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    var blocks = [];
    var date = null;
    var i = 0;
    while (i < lines.length) {
        var line = lines[i];
        var day = DAY_RE.exec(line);
        if (day) {
            date = day[1];
            blocks.push({ type: "day", date: date });
            i += 1;
            continue;
        }
        var entry = date ? ENTRY_RE.exec(line) : null;
        if (!entry) {
            blocks.push({ type: "other", raw: line });
            i += 1;
            continue;
        }
        var parts = [entry[2]];
        var pendingBlank = 0;
        var j = i + 1;
        while (j < lines.length) {
            var cont = CONT_RE.exec(lines[j]);
            if (cont) {
                for (var b = 0; b < pendingBlank; b++) parts.push("");
                pendingBlank = 0;
                parts.push(cont[1]);
            } else if (lines[j] === "") {
                pendingBlank += 1;
            } else {
                break;
            }
            j += 1;
        }
        blocks.push({ type: "entry", date: date, text: parts.join("\n"), done: entry[1] !== " " });
        i = j - pendingBlank;
    }
    return blocks;
}

/**
 * Write blocks back as Store text. Guarantees a blank line before every Day
 * heading (except at the top), no leading/trailing blank lines, one final
 * newline. Everything else is emitted as-is.
 * @param {Array<object>} blocks
 * @returns {string}
 */
function serializeStore(blocks) {
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (block.type === "day") {
            if (out.length > 0 && out[out.length - 1] !== "") out.push("");
            out.push("## " + block.date);
        } else if (block.type === "entry") {
            var lines = String(block.text).split("\n");
            out.push("- [" + (block.done ? "x" : " ") + "] " + lines[0]);
            for (var k = 1; k < lines.length; k++) out.push(lines[k] === "" ? "" : "  " + lines[k]);
        } else {
            out.push(block.raw);
        }
    }
    while (out.length && out[0] === "") out.shift();
    while (out.length && out[out.length - 1] === "") out.pop();
    return out.length ? out.join("\n") + "\n" : "";
}

if (typeof module !== "undefined") {
    module.exports = { parseStore: parseStore, serializeStore: serializeStore };
}
```

- [ ] **Step 4: Run** `bun test test/store.test.js` — Expected: 7 pass.
- [ ] **Step 5: Commit** `feat(store): parse and serialize the markdown store`

---

### Task 3: Store mutations

**Files:**

- Modify: `src/store.js`, `test/store.test.js`

**Interfaces:**

- Produces: `addEntry(blocks, date, text): Block[]`, `toggleDone(blocks, index): Block[]`, `removeEntry(blocks, index): Block[]`. All return new arrays; `index` is the block index.

- [ ] **Step 1: Failing tests** (append to `test/store.test.js`; extend the import)

```js
import { addEntry, toggleDone, removeEntry } from "../src/store.js";

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
    const out = serializeStore(toggleDone(toggleDone(blocks, 2), 2).concat());
    expect(out).toBe("## 2026-09-19\n- [ ] a\n- [ ] b\n");
    expect(serializeStore(toggleDone(blocks, 1))).toBe("## 2026-09-19\n- [x] a\n- [ ] b\n");
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
```

Note the `hi\n    there` expectation: `trim()` strips the string ends only; inner indentation of " there" survives and is serialized with the two-space continuation prefix on top.

- [ ] **Step 2: Run** — Expected: FAIL, `addEntry is not a function`.

- [ ] **Step 3: Implement** (append before the exports guard; add to exports)

```js
function cloneBlocks(blocks) {
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        out.push(
            b.type === "entry"
                ? { type: "entry", date: b.date, text: b.text, done: b.done }
                : b.type === "day"
                  ? { type: "day", date: b.date }
                  : { type: "other", raw: b.raw },
        );
    }
    return out;
}

/** Index just past the last block belonging to the Day heading at `dayIndex`. */
function dayEnd(blocks, dayIndex) {
    var end = dayIndex + 1;
    while (end < blocks.length && blocks[end].type !== "day") end += 1;
    return end;
}

/**
 * Capture: add a new open Entry under `date`, creating the Day if needed.
 * @param {Array<object>} blocks
 * @param {string} date YYYY-MM-DD
 * @param {string} text
 * @returns {Array<object>}
 */
function addEntry(blocks, date, text) {
    var clean = String(text || "")
        .replace(/\r\n?/g, "\n")
        .trim();
    if (!clean) return blocks;
    var out = cloneBlocks(blocks);
    var entry = { type: "entry", date: date, text: clean, done: false };
    var dayIndex = -1;
    var insertDayAt = out.length;
    for (var i = 0; i < out.length; i++) {
        if (out[i].type !== "day") continue;
        if (out[i].date === date) dayIndex = i;
        else if (dayIndex === -1 && out[i].date > date && insertDayAt === out.length)
            insertDayAt = i;
    }
    if (dayIndex === -1) {
        out.splice(insertDayAt, 0, { type: "day", date: date }, entry);
        return out;
    }
    var at = dayIndex + 1;
    for (var j = dayIndex + 1; j < dayEnd(out, dayIndex); j++) {
        if (out[j].type === "entry") at = j + 1;
    }
    out.splice(at, 0, entry);
    return out;
}

/**
 * Flip the Done state of the Entry at `index`. Other indexes are a no-op.
 * @param {Array<object>} blocks
 * @param {number} index
 * @returns {Array<object>}
 */
function toggleDone(blocks, index) {
    var out = cloneBlocks(blocks);
    if (out[index] && out[index].type === "entry") out[index].done = !out[index].done;
    return out;
}

/**
 * Remove the Entry at `index`. A Day left without Entries loses its heading
 * and the blank line that followed it; foreign lines stay.
 * @param {Array<object>} blocks
 * @param {number} index
 * @returns {Array<object>}
 */
function removeEntry(blocks, index) {
    var out = cloneBlocks(blocks);
    if (!out[index] || out[index].type !== "entry") return out;
    var dayIndex = index;
    while (dayIndex >= 0 && out[dayIndex].type !== "day") dayIndex -= 1;
    out.splice(index, 1);
    if (dayIndex < 0) return out;
    for (var i = dayIndex + 1; i < dayEnd(out, dayIndex); i++) {
        if (out[i].type === "entry") return out;
    }
    out.splice(dayIndex, 1);
    while (out[dayIndex] && out[dayIndex].type === "other" && out[dayIndex].raw === "") {
        out.splice(dayIndex, 1);
    }
    return out;
}
```

- [ ] **Step 4: Run** `bun test` — Expected: all pass.
- [ ] **Step 5: Commit** `feat(store): add, toggle and remove entries`

---

### Task 4: Display rows and day labels

**Files:**

- Modify: `src/store.js`, `test/store.test.js`

**Interfaces:**

- Produces: `displayRows(blocks): Array<{index, date, text, done}>`; `dayLabel(date, today): string`.

- [ ] **Step 1: Failing tests**

```js
import { displayRows, dayLabel } from "../src/store.js";

test("displayRows: newest day first, newest entry first, done entries sink within their day", () => {
    const blocks = parseStore(
        "## 2026-09-18\n- [x] old done\n- [ ] old open\n\n## 2026-09-19\n- [ ] a\n- [x] b\n- [ ] c\n",
    );
    expect(displayRows(blocks).map((r) => r.text)).toEqual(["c", "a", "b", "old open", "old done"]);
    expect(displayRows(blocks)[0]).toEqual({
        index: 6,
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
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**

```js
/**
 * Rows in Panel order: Days newest first; within a Day newest first with Done
 * Entries after open ones. `index` addresses the block for mutations.
 * @param {Array<object>} blocks
 * @returns {Array<{index:number,date:string,text:string,done:boolean}>}
 */
function displayRows(blocks) {
    var byDate = {};
    var dates = [];
    for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (b.type !== "entry") continue;
        if (!byDate[b.date]) {
            byDate[b.date] = [];
            dates.push(b.date);
        }
        byDate[b.date].push({ index: i, date: b.date, text: b.text, done: b.done });
    }
    dates.sort();
    dates.reverse();
    var rows = [];
    for (var d = 0; d < dates.length; d++) {
        var day = byDate[dates[d]].slice().reverse();
        for (var o = 0; o < day.length; o++) if (!day[o].done) rows.push(day[o]);
        for (var c = 0; c < day.length; c++) if (day[c].done) rows.push(day[c]);
    }
    return rows;
}

function utcDay(date) {
    var p = String(date).split("-");
    return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) / 86400000;
}

/**
 * @param {string} date YYYY-MM-DD
 * @param {string} today YYYY-MM-DD
 * @returns {string} "Today", "Yesterday" or the date itself
 */
function dayLabel(date, today) {
    var diff = utcDay(today) - utcDay(date);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return date;
}
```

- [ ] **Step 4: Run** `bun test` — Expected: all pass.
- [ ] **Step 5: Commit** `feat(store): display ordering and day labels`

---

### Task 5: Config lookup

**Files:**

- Create: `src/config.js`, `test/config.test.js`

**Interfaces:**

- Produces: `defaultStorePath(home)`, `storePathFrom(shellJsonText, pluginId, home)`, `dirname(path)`.

- [ ] **Step 1: Failing tests**

```js
import { test, expect } from "bun:test";
import { defaultStorePath, storePathFrom, dirname } from "../src/config.js";

const HOME = "/home/p";

test("default store path lives under XDG data", () => {
    expect(defaultStorePath(HOME)).toBe("/home/p/.local/share/omacopper/entries.md");
});

test("storePath is read from the plugin's own entry in shell.json", () => {
    const json = JSON.stringify({
        version: 1,
        plugins: [{ id: "other" }, { id: "scoop.omacopper", storePath: "~/vault/inbox.md" }],
    });
    expect(storePathFrom(json, "scoop.omacopper", HOME)).toBe("/home/p/vault/inbox.md");
});

test("falls back to the default on missing entry, missing field, or broken JSON", () => {
    expect(storePathFrom('{"plugins":[{"id":"x"}]}', "scoop.omacopper", HOME)).toBe(
        defaultStorePath(HOME),
    );
    expect(storePathFrom('{"plugins":[{"id":"scoop.omacopper"}]}', "scoop.omacopper", HOME)).toBe(
        defaultStorePath(HOME),
    );
    expect(storePathFrom("{not json", "scoop.omacopper", HOME)).toBe(defaultStorePath(HOME));
    expect(storePathFrom("", "scoop.omacopper", HOME)).toBe(defaultStorePath(HOME));
});

test("dirname", () => {
    expect(dirname("/a/b/c.md")).toBe("/a/b");
    expect(dirname("c.md")).toBe(".");
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**

```js
// Where the Store lives. The shell injects settings into bar widgets only, so a
// panel plugin reads its own `plugins[]` entry out of shell.json itself.

function defaultStorePath(home) {
    return String(home) + "/.local/share/omacopper/entries.md";
}

function expandHome(path, home) {
    var p = String(path);
    if (p === "~") return String(home);
    if (p.indexOf("~/") === 0) return String(home) + p.slice(1);
    return p;
}

/**
 * @param {string} shellJsonText contents of ~/.config/omarchy/shell.json
 * @param {string} pluginId
 * @param {string} home
 * @returns {string} absolute Store path
 */
function storePathFrom(shellJsonText, pluginId, home) {
    var config = null;
    try {
        config = JSON.parse(String(shellJsonText || ""));
    } catch (e) {
        config = null;
    }
    var plugins = config && Array.isArray(config.plugins) ? config.plugins : [];
    for (var i = 0; i < plugins.length; i++) {
        var entry = plugins[i];
        if (!entry || entry.id !== pluginId) continue;
        if (typeof entry.storePath === "string" && entry.storePath.trim()) {
            return expandHome(entry.storePath.trim(), home);
        }
    }
    return defaultStorePath(home);
}

function dirname(path) {
    var p = String(path);
    var at = p.lastIndexOf("/");
    return at <= 0 ? (at === 0 ? "/" : ".") : p.slice(0, at);
}

if (typeof module !== "undefined") {
    module.exports = {
        defaultStorePath: defaultStorePath,
        storePathFrom: storePathFrom,
        dirname: dirname,
    };
}
```

- [ ] **Step 4: Run** `bun test` — Expected: all pass.
- [ ] **Step 5: Commit** `feat(config): resolve store path from shell.json`

---

### Task 6: Panel.qml

**Files:**

- Create: `Panel.qml`

**Interfaces:**

- Consumes: everything exported by `src/store.js` and `src/config.js`.
- Host contract: `open(payloadJson)`, `close()`, `toggle()`; property `opened`; injected `omarchyPath`, `shell`, `manifest`.

- [ ] **Step 1: Write Panel.qml**

```qml
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui
import "src/store.js" as Store
import "src/config.js" as Config

// The Panel. Everything with logic lives in src/; this file is glue between
// the shell (summon/hide), the Store file, wl-paste/wl-copy and the widgets.
Item {
  id: root

  property string omarchyPath: Quickshell.env("OMARCHY_PATH")
  property var shell: null
  property var manifest: null

  readonly property string home: Quickshell.env("HOME")
  readonly property string pluginId: (manifest && manifest.id) || "scoop.omacopper"

  property bool opened: false
  property var blocks: []
  property string storePath: Config.defaultStorePath(home)
  // -1 while the editor owns the keyboard; otherwise the row under the cursor.
  property int selectedIndex: -1

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color border: Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.spacing.panelPadding
  property int contentSpacing: Style.spacing.md
  property int cardWidth: Math.min(Style.space(640), panel.width - Style.gapsOut * 2)
  property int cardHeight: Math.min(Style.space(560), panel.height - Style.gapsOut * 2)
  property int editorHeight: Style.font.body * 1.5 * 3 + Style.spacing.inputPaddingY * 2

  function today() { return Qt.formatDate(new Date(), "yyyy-MM-dd") }

  function open(payloadJson) {
    root.opened = true
    root.selectedIndex = -1
    editor.text = ""
    mkdirProc.running = true
    storeFile.reload()
    selectionProc.running = true
    Qt.callLater(function() { editor.forceActiveFocus() })
  }

  function close() { root.opened = false }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function loadStore(text) {
    root.blocks = Store.parseStore(text)
    root.rebuildRows()
  }

  function saveStore() {
    storeFile.setText(Store.serializeStore(root.blocks))
  }

  function rebuildRows() {
    var rows = Store.displayRows(root.blocks)
    var now = root.today()
    rowsModel.clear()
    for (var i = 0; i < rows.length; i++) {
      rowsModel.append({
        blockIndex: rows[i].index,
        date: rows[i].date,
        dayLabel: Store.dayLabel(rows[i].date, now),
        text: rows[i].text,
        done: rows[i].done
      })
    }
    if (root.selectedIndex >= rowsModel.count) root.selectedIndex = rowsModel.count - 1
    if (rowsModel.count === 0) root.focusEditor()
  }

  function capture() {
    var next = Store.addEntry(root.blocks, root.today(), editor.text)
    if (next === root.blocks) return
    root.blocks = next
    root.saveStore()
    editor.text = ""
    root.rebuildRows()
  }

  function toggleDone(row) {
    if (row < 0 || row >= rowsModel.count) return
    root.blocks = Store.toggleDone(root.blocks, rowsModel.get(row).blockIndex)
    root.saveStore()
    root.rebuildRows()
  }

  function removeRow(row) {
    if (row < 0 || row >= rowsModel.count) return
    root.blocks = Store.removeEntry(root.blocks, rowsModel.get(row).blockIndex)
    root.saveStore()
    root.rebuildRows()
  }

  function copyBack(row) {
    if (row < 0 || row >= rowsModel.count) return
    Quickshell.execDetached(["wl-copy", "--", rowsModel.get(row).text])
    root.dismiss()
  }

  function focusEditor() {
    root.selectedIndex = -1
    editor.forceActiveFocus()
  }

  function focusList(index) {
    if (rowsModel.count === 0) return
    root.selectedIndex = Math.max(0, Math.min(index, rowsModel.count - 1))
    keyCatcher.forceActiveFocus()
    list.positionViewAtIndex(root.selectedIndex, ListView.Contain)
  }

  function moveCursor(delta) {
    var next = root.selectedIndex + delta
    if (next < 0) { root.focusEditor(); return }
    root.focusList(next)
  }

  ListModel { id: rowsModel }

  FileView {
    id: storeFile
    path: root.storePath
    atomicWrites: true
    printErrors: false
    onLoaded: root.loadStore(text())
    onLoadFailed: root.loadStore("")
  }

  FileView {
    id: shellConfig
    path: root.home + "/.config/omarchy/shell.json"
    watchChanges: true
    printErrors: false
    onLoaded: root.storePath = Config.storePathFrom(text(), root.pluginId, root.home)
    onFileChanged: reload()
  }

  Process {
    id: mkdirProc
    command: ["mkdir", "-p", Config.dirname(root.storePath)]
  }

  Process {
    id: selectionProc
    command: ["wl-paste", "--primary", "--no-newline"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        if (root.opened && editor.text === "" && text.trim() !== "") {
          editor.text = text.trim()
          editor.cursorPosition = editor.length
        }
      }
    }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "omacopper"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle { anchors.fill: parent; color: root.scrim }
    MouseArea { anchors.fill: parent; onClicked: root.dismiss() }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: root.cardHeight
      radius: root.cornerRadius
      anchors.centerIn: parent
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Column {
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        spacing: root.contentSpacing

        BorderSurface {
          width: parent.width
          height: root.editorHeight
          radius: root.cornerRadius
          color: Style.controlFill(editor.activeFocus, false, root.foreground, Color.accent)
          borderSpec: Border.controlSpec(editor.activeFocus ? "focus" : "normal", root.foreground, Color.accent)

          TextArea {
            id: editor
            anchors.fill: parent
            padding: Style.spacing.inputPaddingY
            leftPadding: Style.spacing.controlPaddingX
            rightPadding: Style.spacing.controlPaddingX
            wrapMode: TextEdit.Wrap
            placeholderText: "Capture…"
            placeholderTextColor: Qt.darker(root.foreground, 1.6)
            color: root.foreground
            selectionColor: Style.selectionFillFor(root.foreground, Color.accent)
            selectedTextColor: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            background: null

            Keys.priority: Keys.BeforeItem
            Keys.onPressed: function(event) {
              if (event.key === Qt.Key_Escape) {
                root.dismiss(); event.accepted = true
              } else if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && !(event.modifiers & Qt.ShiftModifier)) {
                root.capture(); event.accepted = true
              } else if (event.key === Qt.Key_Tab) {
                root.focusList(0); event.accepted = true
              } else if (event.key === Qt.Key_Down && editor.text === "") {
                root.focusList(0); event.accepted = true
              }
            }
          }
        }

        Item {
          id: keyCatcher
          width: parent.width
          height: parent.height - root.editorHeight - hint.height - root.contentSpacing * 2

          Keys.priority: Keys.BeforeItem
          Keys.onPressed: function(event) {
            if (event.key === Qt.Key_Escape) {
              root.dismiss()
            } else if (event.key === Qt.Key_Up || event.text === "k") {
              root.moveCursor(-1)
            } else if (event.key === Qt.Key_Down || event.text === "j") {
              root.moveCursor(1)
            } else if (event.key === Qt.Key_Home) {
              root.focusList(0)
            } else if (event.key === Qt.Key_End) {
              root.focusList(rowsModel.count - 1)
            } else if (event.key === Qt.Key_Space) {
              root.toggleDone(root.selectedIndex)
            } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
              root.copyBack(root.selectedIndex)
            } else if (event.key === Qt.Key_Delete) {
              root.removeRow(root.selectedIndex)
            } else if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
              root.focusEditor()
            } else if (event.text && event.text.length === 1 && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127) {
              root.focusEditor()
              editor.insert(editor.length, event.text)
            } else {
              return
            }
            event.accepted = true
          }

          ListView {
            id: list
            anchors.fill: parent
            model: rowsModel
            clip: true
            spacing: Style.space(2)
            boundsBehavior: Flickable.StopAtBounds

            section.property: "dayLabel"
            section.criteria: ViewSection.FullString
            section.delegate: Text {
              textFormat: Text.PlainText
              width: ListView.view.width
              topPadding: Style.space(10)
              bottomPadding: Style.space(4)
              leftPadding: Style.space(12)
              text: section
              color: root.foreground
              opacity: 0.6
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.capitalization: Font.AllUppercase
            }

            delegate: Rectangle {
              id: row
              required property int index
              required property string text
              required property bool done

              readonly property bool hasCursor: index === root.selectedIndex

              width: ListView.view.width
              height: body.implicitHeight + Style.space(16)
              radius: root.cornerRadius
              color: hasCursor ? root.selectedBackground : "transparent"

              Row {
                anchors.fill: parent
                anchors.leftMargin: Style.space(12)
                anchors.rightMargin: Style.space(12)
                anchors.topMargin: Style.space(8)
                anchors.bottomMargin: Style.space(8)
                spacing: Style.space(10)

                Text {
                  id: box
                  text: row.done ? "󰄵" : "󰄱"
                  color: row.hasCursor ? root.selectedText : root.foreground
                  opacity: row.done ? 0.5 : 1
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.title
                  MouseArea {
                    anchors.fill: parent
                    anchors.margins: -Style.space(6)
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.toggleDone(row.index)
                  }
                }

                Text {
                  id: body
                  textFormat: Text.PlainText
                  width: parent.width - box.width - parent.spacing
                  text: row.text
                  color: row.hasCursor ? root.selectedText : root.foreground
                  opacity: row.done ? 0.5 : 1
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  font.strikeout: row.done
                  wrapMode: Text.Wrap
                  maximumLineCount: 3
                  elide: Text.ElideRight
                }
              }

              MouseArea {
                anchors.fill: parent
                z: -1
                cursorShape: Qt.PointingHandCursor
                onClicked: root.focusList(row.index)
                onDoubleClicked: root.copyBack(row.index)
              }
            }

            Column {
              anchors.centerIn: parent
              visible: rowsModel.count === 0
              spacing: Style.space(8)
              Text {
                text: "󰆐"
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                color: root.selectedText
                opacity: 0.8
                font.family: root.fontFamily
                font.pixelSize: Style.font.displayLarge
              }
              Text {
                textFormat: Text.PlainText
                text: "Nothing captured yet"
                color: root.foreground
                opacity: 0.7
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
              }
            }
          }
        }

        Text {
          id: hint
          textFormat: Text.PlainText
          width: parent.width
          text: root.selectedIndex < 0
            ? "Enter save · Shift+Enter newline · Tab list · Esc close"
            : "Space done · Enter copy · Del remove · Tab edit · Esc close"
          color: root.foreground
          opacity: 0.45
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }
      }
    }
  }
}
```

- [ ] **Step 2: Sync and enable**

```bash
rsync -a --delete --exclude .git --exclude node_modules ~/Work/omacopper/ ~/.config/omarchy/plugins/scoop.omacopper/
omarchy plugin validate ~/.config/omarchy/plugins/scoop.omacopper
omarchy-shell shell rescanPlugins
omarchy plugin enable scoop.omacopper
omarchy-shell shell toggle scoop.omacopper
```

Expected: validate prints `manifest ok`; the Panel appears centered. Check `journalctl --user -u omarchy-shell -n 50` (or `omarchy-shell` stderr) for QML errors.

- [ ] **Step 3: Manual checks** (each a separate observation)

1. Select text in a terminal, toggle the Panel: editor is prefilled with it.
2. `Enter` saves it; `cat ~/.local/share/omacopper/entries.md` shows `## <today>` and `- [ ] <text>`.
3. `Shift+Enter` produces a newline; saving stores an indented continuation line.
4. `Tab`, `Space` toggles `[x]`; `Delete` removes; `Enter` closes and `wl-paste` prints the text.
5. Edit the file by hand while closed; re-open shows the edit.
6. Add `"storePath": "~/tmp/inbox.md"` to the `scoop.omacopper` entry in `shell.json`; re-open writes there.

- [ ] **Step 4: Commit** `feat(panel): quick-capture panel`

---

### Task 7: CI, releases, dependabot

**Files:**

- Create: `.github/workflows/ci.yml`, `.github/workflows/release-please.yml`, `.github/dependabot.yml`, `release-please-config.json`, `.release-please-manifest.json`

- [ ] **Step 1: ci.yml** — copy the uptime-kuma CI verbatim (install, `bun test`, eslint, typecheck, prettier check, and the manifest validation block).

- [ ] **Step 2: release-please.yml**

```yaml
name: Release

on:
    push:
        branches: [main]

permissions:
    contents: write
    pull-requests: write

jobs:
    release:
        runs-on: ubuntu-latest
        steps:
            - uses: googleapis/release-please-action@v4
              with:
                  config-file: release-please-config.json
                  manifest-file: .release-please-manifest.json
```

- [ ] **Step 3: release-please-config.json** with `release-type: node`, `package-name: omarchy-plugin-omacopper`, extra-files bumping `manifest.json` `$.version`; `.release-please-manifest.json` = `{ ".": "0.1.0" }`. dependabot.yml: weekly npm + github-actions.

- [ ] **Step 4: Commit** `ci: tests, lint, manifest check and release-please`

---

### Task 8: README

**Files:**

- Create: `README.md`

Sections: what it is (Copper homage, one paragraph), Install (`omarchy plugin add https://github.com/scoop/omarchy-plugin-omacopper --enable`), Keybinding (Lua: `o.bind("SUPER + CTRL + M", "Omacopper", "omarchy-shell shell toggle scoop.omacopper")` in `~/.config/hypr/bindings.lua`), optional menu entry for `~/.config/omarchy/extensions/omarchy-menu.jsonc`, Using it (key table), The file (format with example), Configure (`storePath` on the shell.json entry), Removing, Developing (rsync loop, `bun test`), License.

- [ ] **Step 1: Write it.** **Step 2: Commit** `docs: readme`

---

## Self-review

- Spec coverage: capture/prefill (T6), Store format and fidelity (T2–T3), display order (T4), keyboard model (T6), copy-back (T6), storePath config (T5–T6), plugin packaging (T1, T7), docs (T8). Hotkey and menu entry are user-side, documented in T8.
- Type consistency: `displayRows` returns `index`; Panel stores it as `blockIndex` on the ListModel and passes it to `toggleDone`/`removeEntry`. `storePathFrom(text, id, home)` order matches in T5 and T6.
