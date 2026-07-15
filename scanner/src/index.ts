import { scanAtlas } from "./scan.ts";
import { writeAtlas } from "./output.ts";
import { atlasContextJsonPath, atlasContextMarkdownPath, atlasHtmlPath, atlasJsonPath } from "./paths.ts";

async function main(): Promise<void> {
  const atlas = await scanAtlas();
  await writeAtlas(atlas);

  console.log(`Agent Atlas scan complete`);
  console.log(`Assets: ${atlas.summary.assetCount}`);
  console.log(`Projects: ${atlas.projects.length}`);
  console.log(`Agents: ${atlas.agents.length}`);
  if (atlas.warnings.length) {
    console.log(`Warnings:`);
    for (const warning of atlas.warnings) console.log(`- ${warning}`);
    if (atlas.projects.length === 0) {
      console.log(`Hint: run npm run scan:ada, or set AGENT_ATLAS_PROJECT_ROOTS=/path/to/project`);
    }
  }
  console.log(`JSON: ${atlasJsonPath}`);
  console.log(`Context JSON: ${atlasContextJsonPath}`);
  console.log(`AI Markdown: ${atlasContextMarkdownPath}`);
  console.log(`HTML: ${atlasHtmlPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
