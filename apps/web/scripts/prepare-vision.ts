import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const packageDir = path.dirname(require.resolve("@mediapipe/tasks-vision"));
const runtime = path.join(import.meta.dir, "../public/vision-runtime");
await mkdir(runtime, { recursive: true });
await cp(path.join(packageDir, "wasm"), path.join(runtime, "wasm"), { recursive: true });
await cp(path.join(import.meta.dir, "../public/models/LICENSE"), path.join(runtime, "LICENSE"));
