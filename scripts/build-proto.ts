import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protoDir = resolve(root, "../docs/proto");
const outputDir = resolve(root, "src/worker/proto");
const plugin = resolve(
  root,
  "node_modules/.bin",
  process.platform === "win32" ? "protoc-gen-es.exe" : "protoc-gen-es",
);

if (!existsSync(protoDir)) {
  throw new Error(`Shared protobuf directory missing: ${protoDir}`);
}
if (!existsSync(plugin)) {
  throw new Error(`protoc-gen-es is not installed: ${plugin}`);
}

const files = readdirSync(protoDir)
  .filter((name) => name.endsWith(".proto"))
  .sort()
  .map((name) => join(protoDir, name));

if (files.length === 0) {
  throw new Error(`No protobuf files found in ${protoDir}`);
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const result = spawnSync(
  "protoc",
  [
    `--plugin=protoc-gen-es=${plugin}`,
    `--proto_path=${protoDir}`,
    `--es_out=${outputDir}`,
    "--es_opt=target=ts,import_extension=ts",
    ...files,
  ],
  { stdio: "inherit" },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error(`protoc exited with status ${result.status}`);
}
