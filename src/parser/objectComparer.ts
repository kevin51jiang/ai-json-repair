export class ObjectComparer {
  public static isSameObject(obj1: unknown, obj2: unknown): boolean {
    if (typeof obj1 !== typeof obj2) {
      return false;
    }

    if (Array.isArray(obj1)) {
      if (!Array.isArray(obj2) || obj1.length !== obj2.length) {
        return false;
      }

      return obj1.every((item, index) => ObjectComparer.isSameObject(item, obj2[index]));
    }

    if (obj1 && obj2 && typeof obj1 === "object" && typeof obj2 === "object") {
      const left = obj1 as Record<string, unknown>;
      const right = obj2 as Record<string, unknown>;
      const leftKeys = Object.keys(left);
      const rightKeys = Object.keys(right);

      if (leftKeys.length !== rightKeys.length) {
        return false;
      }

      return leftKeys.every((key) => key in right && ObjectComparer.isSameObject(left[key], right[key]));
    }

    return true;
  }

  public static isStrictlyEmpty(value: unknown): boolean {
    if (typeof value === "string" || Array.isArray(value)) {
      return value.length === 0;
    }

    if (value && typeof value === "object") {
      return Object.keys(value).length === 0;
    }

    return false;
  }
}
