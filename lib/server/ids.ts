import { randomUUID } from "crypto";

export function createServerId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}
