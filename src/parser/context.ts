export const enum ContextValue {
  ObjectKey = "OBJECT_KEY",
  ObjectValue = "OBJECT_VALUE",
  Array = "ARRAY",
}

export class JsonContext {
  public context: ContextValue[] = [];
  public current: ContextValue | undefined;
  public empty = true;

  public set(value: ContextValue): void {
    this.context.push(value);
    this.current = value;
    this.empty = false;
  }

  public reset(): void {
    this.context.pop();
    this.current = this.context[this.context.length - 1];
    this.empty = this.context.length === 0;
  }
}
