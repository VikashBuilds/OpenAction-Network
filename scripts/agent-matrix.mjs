import { readFile } from "node:fs/promises";

const rosterPath = new URL("../ops/agent-mesh.json", import.meta.url);
const roster = JSON.parse(await readFile(rosterPath, "utf8"));
const include = roster.agents.flatMap((agent) => agent.approvedSourceIds.map((sourceId) => ({ agentId: agent.id, sourceId })));
process.stdout.write(JSON.stringify({ include }));
