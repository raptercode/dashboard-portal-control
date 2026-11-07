export function createPoller({
  load,
  render = () => {},
  onError = () => {},
  interval = 5000,
  visible = () => true,
  terminal = () => false,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let active = false,
    running = false,
    timer;
  const schedule = () => {
    if (active)
      timer = setTimer(
        tick,
        typeof interval === "function" ? interval() : interval,
      );
  };
  async function tick() {
    if (!active || running) return;
    if (!visible()) {
      schedule();
      return;
    }
    running = true;
    try {
      const value = await load();
      if (!active) return;
      render(value);
      if (terminal(value)) active = false;
    } catch (error) {
      if (active) onError(error);
    } finally {
      running = false;
      schedule();
    }
  }
  return {
    start({ immediate = false } = {}) {
      if (active) return;
      active = true;
      if (immediate) void tick();
      else schedule();
    },
    run: tick,
    stop() {
      active = false;
      clearTimer(timer);
    },
    get active() {
      return active;
    },
  };
}
