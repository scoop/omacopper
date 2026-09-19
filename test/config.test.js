import { test, expect } from "bun:test";
import { defaultStorePath, storePathFrom, dirname } from "../src/config.js";

const HOME = "/home/p";
const ID = "scoop.omacopper";

test("default store path lives under XDG data", () => {
    expect(defaultStorePath(HOME)).toBe("/home/p/.local/share/omacopper/entries.md");
});

test("storePath is read from the plugin's own entry in shell.json", () => {
    const json = JSON.stringify({
        version: 1,
        plugins: [{ id: "other" }, { id: ID, storePath: "~/vault/inbox.md" }],
    });
    expect(storePathFrom(json, ID, HOME)).toBe("/home/p/vault/inbox.md");
    expect(
        storePathFrom(JSON.stringify({ plugins: [{ id: ID, storePath: "/abs/x.md" }] }), ID, HOME),
    ).toBe("/abs/x.md");
});

test("falls back to the default on missing entry, missing field, or broken JSON", () => {
    expect(storePathFrom('{"plugins":[{"id":"x"}]}', ID, HOME)).toBe(defaultStorePath(HOME));
    expect(storePathFrom('{"plugins":[{"id":"scoop.omacopper"}]}', ID, HOME)).toBe(
        defaultStorePath(HOME),
    );
    expect(storePathFrom('{"plugins":[{"id":"scoop.omacopper","storePath":"  "}]}', ID, HOME)).toBe(
        defaultStorePath(HOME),
    );
    expect(storePathFrom("{not json", ID, HOME)).toBe(defaultStorePath(HOME));
    expect(storePathFrom("", ID, HOME)).toBe(defaultStorePath(HOME));
});

test("dirname", () => {
    expect(dirname("/a/b/c.md")).toBe("/a/b");
    expect(dirname("/c.md")).toBe("/");
    expect(dirname("c.md")).toBe(".");
});
