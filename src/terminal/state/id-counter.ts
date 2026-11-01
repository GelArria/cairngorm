let nextId = 0;

export function nextIdValue(): number {
  return ++nextId;
}

export function uid(): string {
  return String(nextIdValue());
}

export function advanceIdCounter(offset: number) {
  nextId += offset;
}

export function setNextId(value: number) {
  nextId = value;
}
