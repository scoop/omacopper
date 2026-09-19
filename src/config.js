// Where the Store lives. The shell injects settings into bar widgets only, so
// a panel plugin reads its own `plugins[]` entry out of shell.json itself.
// Pure functions, loaded by both QML and the test runner.

/**
 * @param {string} home
 * @returns {string}
 */
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
    var config;
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

/**
 * @param {string} path
 * @returns {string}
 */
function dirname(path) {
    var p = String(path);
    var at = p.lastIndexOf("/");
    if (at < 0) return ".";
    if (at === 0) return "/";
    return p.slice(0, at);
}

if (typeof module !== "undefined") {
    module.exports = {
        defaultStorePath: defaultStorePath,
        storePathFrom: storePathFrom,
        dirname: dirname,
    };
}
