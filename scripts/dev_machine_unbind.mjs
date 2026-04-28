#!/usr/bin/env node

import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const TOKEN_PATH = "config/machine-unbind.json";

async function main() {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question('Type "UNBIND" to remove the dev machine binding on next extension reload: ');
  rl.close();

  if (answer !== "UNBIND") {
    throw new Error("Canceled. Exact confirmation was not provided.");
  }

  const token = {
    confirmation: "UNBIND",
    token_id: `unbind_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    created_at: new Date().toISOString()
  };

  await fs.mkdir("config", { recursive: true });
  await fs.writeFile(TOKEN_PATH, `${JSON.stringify(token, null, 2)}\n`, "utf8");
  console.log(`Wrote ${TOKEN_PATH}. Reload the unpacked extension once to consume it.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
