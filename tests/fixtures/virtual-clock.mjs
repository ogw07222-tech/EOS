// Opt-in process-local clock for isolated server integration tests only.
// Date.now advances by a small deterministic step per call; browser and
// production processes never load this fixture.
const step = Number(process.env.TERRA_VIRTUAL_TIME_STEP_MS || 0);
if (Number.isFinite(step) && step > 0) {
  const realDateNow = globalThis.Date.now.bind(globalThis.Date);
  let now = realDateNow();
  globalThis.Date.now = () => (now += step);
}
