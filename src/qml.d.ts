// QML loads these files as plain scripts with no module system. The trailing
// module.exports guard exists only for the test runner, so `module` is
// declared here rather than by pulling in Node typings.
declare var module: { exports: unknown } | undefined;
