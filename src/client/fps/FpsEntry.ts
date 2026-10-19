// Connects the self-contained FPS mode (the rest of this folder) to the
// client: map files from the CDN, translations and the player's name.
// The main menu loads this module with import() when the FPS card is clicked.

import { maps } from "@openfront/engine-api/game/GameTypes";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import { translateText } from "../Utils";
import { FpsLauncher, FpsLoadedMap } from "./FpsLauncher";

let launcher: FpsLauncher | null = null;

async function loadMap(key: string): Promise<FpsLoadedMap> {
  const info = maps.find((m) => m.id === key);
  if (!info) throw new Error(`Unknown map: ${key}`);
  const data = terrainMapFileLoader.getMapData(info.type);
  const [manifest, bytes] = await Promise.all([
    data.manifest(),
    data.map4xBin(),
  ]);
  return {
    terrain: {
      bytes,
      width: manifest.map4x.width,
      height: manifest.map4x.height,
    },
    fullWidth: manifest.map.width,
    fullHeight: manifest.map.height,
    nations: manifest.nations.flatMap((n) => {
      if (!n.coordinates) return [];
      const strength = (n as { strength?: number }).strength;
      return [
        {
          name: n.name,
          x: n.coordinates[0],
          y: n.coordinates[1],
          strength: typeof strength === "number" ? strength : 1,
        },
      ];
    }),
  };
}

/** Translations load in the background; a #fps link can be faster. */
async function translationsReady(): Promise<void> {
  for (let i = 0; i < 40 && translateText("fps.title") === "fps.title"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

let opening = false;

/** Opens the FPS mode's setup screen over the page. */
export async function launchFps(playerName: string): Promise<void> {
  if (launcher || opening) return;
  opening = true;
  await translationsReady();
  opening = false;
  launcher = new FpsLauncher({
    t: translateText,
    maps: maps.map((m) => ({
      key: m.id,
      name: translateText(m.translationKey),
    })),
    defaultMap: "Hungary",
    loadMap,
    playerName,
    onExit: () => {
      launcher = null;
      if (location.hash === "#fps") {
        history.replaceState(null, "", location.pathname + location.search);
      }
    },
  });
}
