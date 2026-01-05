import { worldEvents } from "../../core/worldEvents/singleton.js";

export async function emitCityPlaceholder(args?: {
  note?: string;
  city_id?: string;
  tick?: number;
}) {
  await worldEvents.emit({
    tier: "T1",
    tags: ["CITY"],
    title: "city.placeholder.emitted.v1",
    summary: args?.note ?? "wire-up test emit",
    meta: {
      tick: args?.tick,
      city_id: args?.city_id,
    },
  });
}
