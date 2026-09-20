// The Store: one markdown file, parsed into blocks and written back. Pure
// functions only — no QML, no I/O — so the test runner and the shell load the
// same file. Vocabulary is CONTEXT.md's: Day, Entry, Done, Store.
//
// A block is one of:
//   { type: "day",   date }                 a `## YYYY-MM-DD` heading
//   { type: "entry", date, text, done }     a `- [ ]` / `- [x]` item under a Day
//   { type: "other", raw }                  any line the app does not own, verbatim

/**
 * @typedef {object} Block
 * @property {string} type "day", "entry" or "other"
 * @property {string} [date] YYYY-MM-DD, on day and entry blocks
 * @property {string} [text] entry text, newline-joined
 * @property {boolean} [done] entry Done state
 * @property {string} [raw] the verbatim line, on other blocks
 */

var DAY_RE = /^## (\d{4}-\d{2}-\d{2})\s*$/;
var ENTRY_RE = /^- \[( |x|X)\] ?(.*)$/;
var CONT_RE = /^ {2}(.*)$/;

/**
 * Parse Store text into blocks. Entries outside a Day, and any line the app
 * does not own, become `other` blocks kept verbatim. Blank lines inside an
 * Entry belong to it only when a continuation line follows them.
 *
 * @param {string} text
 * @returns {Array<Block>}
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
        blocks.push({
            type: "entry",
            date: date,
            text: parts.join("\n"),
            done: entry[1] !== " ",
        });
        i = j - pendingBlank;
    }
    return blocks;
}

/**
 * Write blocks back as Store text. Guarantees a blank line before every Day
 * heading (except at the top), no leading or trailing blank lines, and one
 * final newline. Everything else is emitted as-is.
 *
 * @param {Array<Block>} blocks
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
            for (var k = 1; k < lines.length; k++) {
                out.push(lines[k] === "" ? "" : "  " + lines[k]);
            }
        } else {
            out.push(block.raw);
        }
    }
    while (out.length && out[0] === "") out.shift();
    while (out.length && out[out.length - 1] === "") out.pop();
    return out.length ? out.join("\n") + "\n" : "";
}

function cloneBlocks(blocks) {
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (b.type === "entry") {
            out.push({ type: "entry", date: b.date, text: b.text, done: b.done });
        } else if (b.type === "day") {
            out.push({ type: "day", date: b.date });
        } else {
            out.push({ type: "other", raw: b.raw });
        }
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
 * Returns the input untouched when the text is blank.
 *
 * @param {Array<Block>} blocks
 * @param {string} date YYYY-MM-DD
 * @param {string} text
 * @returns {Array<Block>}
 */
function addEntry(blocks, date, text) {
    var clean = String(text || "")
        .replace(/\r\n?/g, "\n")
        .trim();
    if (!clean) return blocks;
    var out = cloneBlocks(blocks);
    var entry = { type: "entry", date: date, text: clean, done: false };
    var dayIndex = -1;
    var insertDayAt = -1;
    for (var i = 0; i < out.length; i++) {
        if (out[i].type !== "day") continue;
        if (out[i].date === date) dayIndex = i;
        else if (insertDayAt === -1 && out[i].date > date) insertDayAt = i;
    }
    if (dayIndex === -1) {
        out.splice(
            insertDayAt === -1 ? out.length : insertDayAt,
            0,
            { type: "day", date: date },
            entry,
        );
        return out;
    }
    var at = dayIndex + 1;
    var end = dayEnd(out, dayIndex);
    for (var j = dayIndex + 1; j < end; j++) {
        if (out[j].type === "entry") at = j + 1;
    }
    out.splice(at, 0, entry);
    return out;
}

/**
 * Flip the Done state of the Entry at `index`. Other indexes are a no-op.
 *
 * @param {Array<Block>} blocks
 * @param {number} index
 * @returns {Array<Block>}
 */
function toggleDone(blocks, index) {
    var out = cloneBlocks(blocks);
    if (out[index] && out[index].type === "entry") out[index].done = !out[index].done;
    return out;
}

/**
 * Remove the Entry at `index`. A Day left without Entries loses its heading
 * and the blank lines that followed it; foreign lines stay.
 *
 * @param {Array<Block>} blocks
 * @param {number} index
 * @returns {Array<Block>}
 */
function removeEntry(blocks, index) {
    var out = cloneBlocks(blocks);
    if (!out[index] || out[index].type !== "entry") return out;
    var dayIndex = index;
    while (dayIndex >= 0 && out[dayIndex].type !== "day") dayIndex -= 1;
    out.splice(index, 1);
    if (dayIndex < 0) return out;
    var end = dayEnd(out, dayIndex);
    for (var i = dayIndex + 1; i < end; i++) {
        if (out[i].type === "entry") return out;
    }
    out.splice(dayIndex, 1);
    while (out[dayIndex] && out[dayIndex].type === "other" && out[dayIndex].raw === "") {
        out.splice(dayIndex, 1);
    }
    return out;
}

/**
 * Edit: replace the text of the Entry at `index`, keeping its Done state.
 * Blank text and non-Entry indexes leave the input untouched.
 *
 * @param {Array<Block>} blocks
 * @param {number} index
 * @param {string} text
 * @returns {Array<Block>}
 */
function updateEntry(blocks, index, text) {
    var clean = String(text || "")
        .replace(/\r\n?/g, "\n")
        .trim();
    if (!clean || !blocks[index] || blocks[index].type !== "entry") return blocks;
    var out = cloneBlocks(blocks);
    out[index].text = clean;
    return out;
}

/**
 * Rows in Panel order: Days newest first; within a Day newest first, with Done
 * Entries after open ones. `index` addresses the block for mutations.
 *
 * @param {Array<Block>} blocks
 * @returns {Array<{index: number, date: string, text: string, done: boolean}>}
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

if (typeof module !== "undefined") {
    module.exports = {
        parseStore: parseStore,
        serializeStore: serializeStore,
        addEntry: addEntry,
        toggleDone: toggleDone,
        removeEntry: removeEntry,
        updateEntry: updateEntry,
        displayRows: displayRows,
        dayLabel: dayLabel,
    };
}
