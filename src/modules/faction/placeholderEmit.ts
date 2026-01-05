import { worldEvents } from "../../core/worldEvents/singleton.js";

export async function emitFactionPlaceholder(args?: {
  note?: string;
  faction_id?: string;
  tick?: number;
}) {
  await worldEvents.emit({
    tier: "T1",
    tags: ["FACTION"],
    title: "faction.placeholder.emitted.v1",
    summary: args?.note ?? "wire-up test emit",
    meta: {
      tick: args?.tick,
      faction_id: args?.faction_id,
    },
  });
}
