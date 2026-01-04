import type { WorldEvent } from "./worldEvent.js";

export type WorldEventHandler = (e: WorldEvent) => Promise<void> | void;

export class WorldEventBus {
  private handlers: WorldEventHandler[] = [];

  on(handler: WorldEventHandler) {
    this.handlers.push(handler);
  }

  async emit(e: WorldEvent) {
    const event: WorldEvent = { ts: new Date().toISOString(), ...e };
    for (const h of this.handlers) {
      try {
        await h(event);
      } catch {
        // رخداد جهان نباید سیستم را بخواباند
      }
    }
  }
}
