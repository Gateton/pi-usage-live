// Registers the "./x.js" -> "./x.ts" resolve hook before the test runner loads any
// test file. Referenced from package.json's test script via --import.
import { register } from "node:module";

register("./resolve-ts.mjs", import.meta.url);
