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

var MAX_PATH = 4096;

/**
 * Whether a configured path is one the store helper will accept: absolute,
 * bounded, no control characters, no `.` or `..` components.
 *
 * @param {string} path already home-expanded
 * @returns {boolean}
 */
function acceptablePath(path) {
    if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH) return false;
    if (path.charAt(0) !== "/") return false;
    for (var i = 0; i < path.length; i++) {
        var c = path.charCodeAt(i);
        if (c < 0x20 || c === 0x7f) return false;
    }
    var parts = path.split("/");
    for (var j = 1; j < parts.length; j++) {
        if (parts[j] === "" || parts[j] === "." || parts[j] === "..") return false;
    }
    return true;
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
            var candidate = expandHome(entry.storePath.trim(), home);
            return acceptablePath(candidate) ? candidate : defaultStorePath(home);
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
