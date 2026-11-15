export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startClock } = await import("./lib/clock");
    startClock();
  }
}
