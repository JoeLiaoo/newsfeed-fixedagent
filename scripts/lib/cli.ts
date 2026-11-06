/** 读取 --key value 或单独的 --flag。 */
export function parseArgs(argv: string[]): Map<string, string | true> {
  const args = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) args.set(key, true);
    else { args.set(key, next); index++; }
  }
  return args;
}
