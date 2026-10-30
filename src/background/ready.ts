// Placeholder barrier: every message/command handler awaits ready() before acting,
// so nothing runs before the service worker has finished initialising.
let resolveReady: () => void = () => {};
const barrier = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

export function ready(): Promise<void> {
  return barrier;
}

export function markReady(): void {
  resolveReady();
}
