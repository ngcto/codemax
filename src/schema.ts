import { Type, type TUnsafe } from "typebox";
export function enumSchema<const T extends string>(values: readonly T[]): TUnsafe<T> { return Type.Unsafe<T>({ type: "string", enum: [...values] }); }
