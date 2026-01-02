export type EventName = string;
export type EventPayload = unknown;

export type EventHandler<T = EventPayload> = (payload: T) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<EventName, EventHandler[]>();

  on<T>(name: EventName, handler: EventHandler<T>) {
    const list = this.handlers.get(name) ?? [];
    list.push(handler as EventHandler);
    this.handlers.set(name, list);
  }

  async emit<T>(name: EventName, payload: T) {
    const list = this.handlers.get(name) ?? [];
    for (const h of list) await h(payload);
  }
}
