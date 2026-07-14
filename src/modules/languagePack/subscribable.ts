export type Unsubscribe = () => void;

export class Subscribable<T> {
  private listeners = new Set<(payload: T) => void>();

  subscribe(listener: (payload: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(payload: T): void {
    for (const listener of this.listeners) {
      listener(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
