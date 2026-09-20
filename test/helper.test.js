import { test, expect, beforeEach, afterEach } from "bun:test";
import {
    mkdtempSync,
    mkdirSync,
    chmodSync,
    writeFileSync,
    readFileSync,
    symlinkSync,
    statSync,
    rmSync,
} from "node:fs";
import { join } from "node:path";

// The store helper is exercised for real: the refusals it exists for are
// properties of open(2) flags and fstat(2) results, not of any JavaScript.

const HELPER = join(import.meta.dir, "..", "bin", "store.py");
const CAP = 4096;

let dir;
beforeEach(() => {
    // Under $HOME so the directory policy treats it as a directory the person
    // named: owned by us, not writable by others.
    dir = mkdtempSync(join(process.env.HOME, ".omacopper-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(op, path, input) {
    const proc = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", HELPER, op, path, String(CAP)], {
        stdin: input === undefined ? "ignore" : Buffer.from(input),
        stdout: "pipe",
        stderr: "pipe",
    });
    return { code: proc.exitCode, out: proc.stdout.toString() };
}

test("reads a regular file it owns", () => {
    writeFileSync(join(dir, "a.md"), "## 2026-09-20\n- [ ] x\n");
    expect(run("read", join(dir, "a.md"))).toEqual({ code: 0, out: "## 2026-09-20\n- [ ] x\n" });
});

test("a missing file is exit 3, distinct from a refusal", () => {
    expect(run("read", join(dir, "missing.md")).code).toBe(3);
});

test("refuses to read through a symlink", () => {
    writeFileSync(join(dir, "victim"), "secret");
    symlinkSync(join(dir, "victim"), join(dir, "a.md"));
    expect(run("read", join(dir, "a.md")).code).toBe(4);
});

test("refuses a FIFO instead of blocking on it", () => {
    Bun.spawnSync(["/usr/bin/mkfifo", join(dir, "a.md")]);
    expect(run("read", join(dir, "a.md")).code).toBe(4);
});

test("refuses a file over the cap rather than truncating it", () => {
    writeFileSync(join(dir, "a.md"), "x".repeat(CAP + 1));
    expect(run("read", join(dir, "a.md")).code).toBe(5);
    writeFileSync(join(dir, "a.md"), "x".repeat(CAP));
    expect(run("read", join(dir, "a.md")).code).toBe(0);
});

test("refuses a file that group or others can write to", () => {
    writeFileSync(join(dir, "a.md"), "x");
    chmodSync(join(dir, "a.md"), 0o666);
    expect(run("read", join(dir, "a.md")).code).toBe(4);
    chmodSync(join(dir, "a.md"), 0o644);
    expect(run("read", join(dir, "a.md")).code).toBe(0);
});

test("refuses a directory that others can write to", () => {
    const shared = join(dir, "shared");
    mkdirSync(shared);
    chmodSync(shared, 0o777);
    writeFileSync(join(shared, "a.md"), "x");
    expect(run("read", join(shared, "a.md")).code).toBe(4);
});

test("writes a new file as 0600 and reads it back", () => {
    expect(run("write", join(dir, "a.md"), "hello\n").code).toBe(0);
    expect(statSync(join(dir, "a.md")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, "a.md"), "utf8")).toBe("hello\n");
});

test("writing over a planted symlink replaces the link and leaves the target alone", () => {
    writeFileSync(join(dir, "victim"), "must survive");
    symlinkSync(join(dir, "victim"), join(dir, "a.md"));
    expect(run("write", join(dir, "a.md"), "new").code).toBe(0);
    expect(readFileSync(join(dir, "victim"), "utf8")).toBe("must survive");
    expect(statSync(join(dir, "a.md")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dir, "a.md"), "utf8")).toBe("new");
});

test("keeps the permission bits of a file it replaces, capped at 0644", () => {
    writeFileSync(join(dir, "a.md"), "old", { mode: 0o666 });
    expect(run("write", join(dir, "a.md"), "new").code).toBe(0);
    expect(statSync(join(dir, "a.md")).mode & 0o777).toBe(0o644);
});

test("refuses a payload over the cap", () => {
    expect(run("write", join(dir, "a.md"), "x".repeat(CAP + 1)).code).toBe(5);
});

test("rejects relative paths, traversal and control characters", () => {
    expect(run("read", "relative.md").code).toBe(2);
    expect(run("read", dir + "/../x.md").code).toBe(2);
    expect(run("read", join(dir, "a\nb.md")).code).toBe(2);
});
