export function getImports(fileContent: string): string[] {
  return findImportsWithRegexps(fileContent);
}

function findImportsWithRegexps(fileContent: string): string[] {
  const importsRegexp: RegExp = /import\s+(?:(?:"([^;]*)"|'([^;]*)')(?:;|\s+as\s+[^;]*;)|.+from\s+(?:"(.*)"|'(.*)');)/g;

  let imports: string[] = [];
  let result: RegExpExecArray | null;

  while (true) {
    result = importsRegexp.exec(fileContent);
    if (result === null) {
      return imports;
    }

    imports = [
      ...imports,
      ...result.slice(1).filter((m: any) => m !== undefined),
    ];
  }
}
