// Add global mocks or configuration here if needed
import "vitest-canvas-mock";
// Registers the per-test DOM teardown. Imported here, and not from individual
// test files, so its hooks are registered before any test file's own -- see the
// hook-order note in that file.
import "./domTeardown";

// ServerEnv.gitCommit() throws when unset; the dev server sets GIT_COMMIT=DEV,
// so tests exercising server code (e.g. the lobby feed) mirror that.
process.env.GIT_COMMIT ??= "DEV";

// This fork makes every cosmetic free (packages/shared/src/FreeCosmetics.ts).
// The upstream tests exercise the original ownership rules, so by default they
// run without the free wildcard flares. tests/FreeCosmetics.test.ts unmocks
// the module to test the free behaviour itself.
vi.mock("@openfront/shared/FreeCosmetics", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@openfront/shared/FreeCosmetics")>();
  return {
    ...actual,
    withFreeFlares: (flares: readonly string[] | undefined) => [
      ...(flares ?? []),
    ],
  };
});
