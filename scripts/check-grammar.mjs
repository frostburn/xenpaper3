import { readFile } from "node:fs/promises";

import peggy from "peggy";

const grammar = await readFile(new URL("../sw-patch.peggy", import.meta.url), "utf8");
const source = await readFile(new URL("../default.swpatch", import.meta.url), "utf8");
const parser = peggy.generate(grammar);
const program = parser.parse(source);

if (program.type !== "Program") {
  throw new Error(`Expected a Program, received ${program.type ?? "no node type"}`);
}

const statements = program.body.filter(({ type }) => type !== "CommentStatement");
const statementTypes = statements.map(({ type }) => type);

for (const expectedType of [
  "TypeAlias",
  "ConstDeclaration",
  "ParamDeclaration",
  "TriggerHandler",
]) {
  if (!statementTypes.includes(expectedType)) {
    throw new Error(`default.swpatch did not produce a ${expectedType}`);
  }
}

const handler = statements.find(({ type }) => type === "TriggerHandler");
if (handler.body.length === 0) {
  throw new Error("The default trigger handler parsed with an empty body");
}

console.log(`Parsed default.swpatch into ${program.body.length} top-level statements.`);
