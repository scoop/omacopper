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
            globals: { Bun: "readonly", Buffer: "readonly", process: "readonly" },
        },
    },
];
