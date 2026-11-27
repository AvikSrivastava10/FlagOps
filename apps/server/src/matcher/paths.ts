/**
 * The one test-like rule (architecture.md 8.1): a directory segment `__tests__`, `__mocks__`,
 * `test`, `tests`, `e2e` or `cypress`, or a file name ending in `.test`, `.spec` or `.stories`
 * before a JavaScript or TypeScript extension. Paths are repository-relative and POSIX.
 */
const testLike =
  /(^|\/)(__tests__|__mocks__|tests?|e2e|cypress)\/|\.(test|spec|stories)\.[cm]?[jt]sx?$/;

export function isTestLike(path: string): boolean {
  return testLike.test(path);
}

/** The extensions the matcher parses (8.1). */
const codeFile = /\.(?:[cm]?[jt]s|[jt]sx)$/;

export function isCodeFile(path: string): boolean {
  return codeFile.test(path) && !/\.d\.[cm]?ts$/.test(path) && !path.endsWith('.min.js');
}
