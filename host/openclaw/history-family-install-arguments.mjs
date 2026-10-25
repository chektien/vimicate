// Legacy installer command validation, with no filesystem or service effects.
export function fail(message) {
  throw new Error(`vimicate history-family installer: ${message}`);
}

export function parseArguments(argv) {
  const result = { applyLive: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--package-dir") result.packageDir = argv[++index];
    else if (argument === "--apply-live") result.applyLive = true;
    else if (argument === "--dry-run") result.dryRun = true;
    else fail(`unknown argument ${JSON.stringify(argument)}`);
  }
  if (!result.packageDir) fail("--package-dir is required");
  return result;
}
