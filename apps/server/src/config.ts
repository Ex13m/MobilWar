export const config = {
  port: Number(process.env.PORT ?? 8080),
  dbPath: process.env.DB_PATH ?? "./data/mobilwar.db",
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  refereePin: process.env.REFEREE_PIN ?? "1234",
  /** Rooms with no players are removed after this many ms. */
  emptyRoomTtlMs: 30 * 60 * 1000,
};
