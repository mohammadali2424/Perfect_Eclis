export class EventBus {
    handlers = new Map();
    on(name, handler) {
        const list = this.handlers.get(name) ?? [];
        list.push(handler);
        this.handlers.set(name, list);
    }
    async emit(name, payload) {
        const list = this.handlers.get(name) ?? [];
        for (const h of list)
            await h(payload);
    }
}
