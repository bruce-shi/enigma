import assert from "node:assert/strict";
import test from "node:test";

import { validateReleaseVersions } from "./verify-release-version.mjs";

const synchronizedSources = {
  "package.json": "0.1.0",
  "apps/desktop/package.json": "0.1.0",
  "apps/desktop/src-tauri/tauri.conf.json": "0.1.0",
  "Cargo.toml [workspace.package]": "0.1.0",
  "apps/embedded/platforms/esp-idf/Cargo.toml [package]": "0.1.0",
};

test("accepts synchronized versions and their matching tag", () => {
  assert.equal(validateReleaseVersions(synchronizedSources, "v0.1.0"), "0.1.0");
});

test("rejects a version disagreement", () => {
  assert.throws(
    () =>
      validateReleaseVersions({
        ...synchronizedSources,
        "apps/desktop/package.json": "0.1.1",
      }),
    /versions are not synchronized/,
  );
});

test("rejects a tag that does not match the authoritative version", () => {
  assert.throws(
    () => validateReleaseVersions(synchronizedSources, "v0.1.1"),
    /does not match authoritative version v0\.1\.0/,
  );
});
