import mongoose from "mongoose";

const MONGO_URI_ENV = "MONGO_URL";

let isConnecting = false;
let retryTimer: NodeJS.Timeout | null = null;
let retryCount = 0;

const getMongoUri = (): string | null => {
  const raw = process.env[MONGO_URI_ENV];
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const connectDB = async (): Promise<void> => {
  const mongoUri = getMongoUri();
  if (!mongoUri) {
    console.error(
      `MongoDB URI missing. Set ${MONGO_URI_ENV} in your backend .env file.`,
    );
    return;
  }

  if (mongoose.connection.readyState === 1 || isConnecting) {
    return;
  }

  try {
    isConnecting = true;

    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000,
    });

    retryCount = 0;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    console.log(`Database Connected: ${conn.connection.host}`);
    console.log(` Database Name: ${conn.connection.name}`);
  } catch (error: any) {
    const message = error?.message ?? String(error);
    console.error(" MongoDB connection error:", message);

    const lower = String(message).toLowerCase();
    if (lower.includes("bad auth") || lower.includes("authentication failed")) {
      console.error(
        " MongoDB auth failed: verify the username/password in MONGO_URL and that the DB user exists/has access.",
      );
    }
    if (lower.includes("enotfound") || lower.includes("querysrv")) {
      console.error(
        " MongoDB DNS/SRV lookup failed: verify network DNS, or switch to a standard (non-SRV) MongoDB connection string.",
      );
    }

    const delayMs = Math.min(30_000, 1000 * 2 ** retryCount);
    retryCount += 1;
    console.log(` Retrying MongoDB connection in ${Math.round(delayMs / 1000)}s...`);
    retryTimer = setTimeout(() => {
      void connectDB();
    }, delayMs);
  }
  finally {
    isConnecting = false;
  }
};

mongoose.connection.on("disconnected", () => {
  console.log("MongoDB disconnected");
});

mongoose.connection.on("error", (err) => {
  console.error("MongoDB error:", err);
});
