export interface Repository<T, Id = string> {
  get(id: Id): Promise<T | null>;
  upsert(entity: T): Promise<void>;
}
