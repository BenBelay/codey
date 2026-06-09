import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scanTargets = [
  "manifest.json",
  "package.json",
  "README.md",
  "src",
  "tests"
];
const generatedConfigPath = resolve(projectRoot, "src/private/geminiConfig.js");
const keyPrefix = "AI" + "za";
const keyPattern = new RegExp(`${keyPrefix}[A-Za-z0-9_-]{20,}`);

test("public extension files do not contain API key literals or generated config", async () => {
  const files = [];

  for (const target of scanTargets) {
    files.push(...await listFiles(resolve(projectRoot, target)));
  }

  assert.equal(files.includes(generatedConfigPath), false);

  const matches = [];
  for (const file of files) {
    const contents = await readFile(file, "utf8");
    if (keyPattern.test(contents)) {
      matches.push(file);
    }
  }

  assert.deepEqual(matches, []);
});

async function listFiles(path) {
  const info = await stat(path);
  if (info.isFile()) {
    return [path];
  }

  const entries = await readdir(path, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const childPath = resolve(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(childPath));
    } else if (entry.isFile()) {
      files.push(childPath);
    }
  }

  return files;
}
