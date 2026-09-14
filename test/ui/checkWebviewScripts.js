// Type-checks and lints the script inside every Deckard webview.
//
// The page scripts are JavaScript assembled in template literals, so the
// compiler never sees them. This renders each page, extracts its final
// script, and runs the TypeScript checker (with DOM types) and a few ESLint
// correctness rules over it. Only mistakes are reported: untyped DOM code
// also produces type noise, such as EventTarget having no closest(), that
// says nothing about a bug.
//
//   npm run test:ui          (after the layout and contract checks)
//   node test/ui/checkWebviewScripts.js --all   lists every diagnostic code
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { Linter } = require('eslint');
const { pages } = require('./pages.js');

/** TypeScript diagnostics that mean a real mistake in plain JavaScript. */
const REPORTED_CODES = new Map([
  [2304, 'unknown name'],
  [2552, 'unknown name'],
  [2300, 'duplicate identifier'],
  [2393, 'duplicate function'],
  [2451, 'redeclared variable'],
  [2448, 'used before its declaration'],
  [2554, 'wrong number of arguments'],
  [2555, 'too few arguments'],
]);

/** What VS Code gives a webview script. */
const AMBIENT = `
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
  getState(): any;
};
`;

const LINT_RULES = {
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-dupe-else-if': 'error',
  'no-unreachable': 'error',
  'no-self-assign': 'error',
  'no-unsafe-negation': 'error',
  'no-constant-binary-expression': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
};

const reportAll = process.argv.includes('--all');
const directory = mkdtempSync(path.join(tmpdir(), 'deckard-webview-scripts-'));
const ambientFile = path.join(directory, 'webview.d.ts');
writeFileSync(ambientFile, AMBIENT);
const linter = new Linter({ configType: 'flat' });
const problems = [];

try {
  for (const [name, render] of pages) {
    const scripts = [...render().matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1]);
    scripts.forEach((script, scriptIndex) => {
      const label = scripts.length > 1 ? `${name} script ${scriptIndex + 1}` : name;
      const file = path.join(directory, `${name}-${scriptIndex}.js`);
      writeFileSync(file, script);
      const lines = script.split('\n');
      const report = (line, kind, message) =>
        problems.push(
          `${label}:${line}: ${kind}: ${message}\n      ${(lines[line - 1] ?? '').trim().slice(0, 120)}`,
        );

      const program = ts.createProgram([file, ambientFile], {
        allowJs: true,
        checkJs: true,
        noEmit: true,
        strict: false,
        noImplicitAny: false,
        target: ts.ScriptTarget.ES2022,
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
        types: [],
      });
      const source = program.getSourceFile(file);
      const diagnostics = [
        ...program.getSyntacticDiagnostics(source).map((diagnostic) => [diagnostic, 'syntax error']),
        ...program.getSemanticDiagnostics(source).map((diagnostic) => [
          diagnostic,
          REPORTED_CODES.get(diagnostic.code),
        ]),
      ];
      if (reportAll) {
        const counts = new Map();
        diagnostics.forEach(([diagnostic]) =>
          counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + 1),
        );
        console.log(`  ${label}: ${[...counts].map(([code, count]) => `TS${code}×${count}`).join(' ') || 'no diagnostics'}`);
      }
      for (const [diagnostic, kind] of diagnostics) {
        if (!kind || diagnostic.start === undefined) {
          continue;
        }
        const { line } = source.getLineAndCharacterOfPosition(diagnostic.start);
        report(line + 1, kind, ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
      }

      for (const message of linter.verify(script, [
        { languageOptions: { ecmaVersion: 2022, sourceType: 'script' }, rules: LINT_RULES },
      ])) {
        report(message.line, message.ruleId ?? 'lint', message.message);
      }
      console.log(`  checked ${label} (${lines.length} lines)`);
    });
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s) in webview scripts:`);
  problems.forEach((problem) => console.log(`  ${problem}`));
  process.exit(1);
}
console.log('\nevery webview script type-checks and lints clean');
