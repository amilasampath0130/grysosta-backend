import mongoose from "mongoose";

const MONGO_URI_ENV = "MONGO_URL";
const MONGO_FALLBACK_URI_ENV = "MONGO_URL_FALLBACK";

let isConnecting = false;
let retryTimer: NodeJS.Timeout | null = null;
let retryCount = 0;
let hasEverConnected = false;

const getMongoUri = (): string | null => {
  const raw = process.env[MONGO_URI_ENV];
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getMongoFallbackUri = (): string | null => {
  const raw = process.env[MONGO_FALLBACK_URI_ENV];
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isSrvDnsFailure = (message: string): boolean => {
  const lower = message.toLowerCase();
  return lower.includes("enotfound") || lower.includes("querysrv");
};

export const connectDB = async (): Promise<void> => {
  const mongoUri = getMongoUri();
  const fallbackUri = getMongoFallbackUri();
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

    const connectWithUri = async (uri: string) =>
      mongoose.connect(uri, {
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 10000,
      });

    let conn;
    try {
      conn = await connectWithUri(mongoUri);
    } catch (primaryError: any) {
      const primaryMessage = primaryError?.message ?? String(primaryError);

      // If SRV DNS resolution is flaky/blocked, allow a standard (non-SRV) seedlist URI fallback.
      if (fallbackUri && isSrvDnsFailure(primaryMessage)) {
        console.error(" MongoDB connection error:", primaryMessage);
        console.error(
          " MongoDB DNS/SRV lookup failed for MONGO_URL; trying MONGO_URL_FALLBACK...",
        );
        conn = await connectWithUri(fallbackUri);
      } else {
        throw primaryError;
      }
    }

    retryCount = 0;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    hasEverConnected = true;

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
    if (isSrvDnsFailure(String(message))) {
      console.error(
        " MongoDB DNS/SRV lookup failed: verify network DNS, or switch to a standard (non-SRV) MongoDB connection string.",
      );
      if (!fallbackUri && mongoUri.startsWith("mongodb+srv://")) {
        console.error(
          ` Tip: You can set ${MONGO_FALLBACK_URI_ENV} to a standard mongodb:// seedlist URI from Atlas as a fallback for networks that block SRV lookups.`,
        );
      }
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
  // Mongoose may emit disconnected during initial connection failures.
  if (hasEverConnected) {
    console.log("MongoDB disconnected");
  }
});

mongoose.connection.on("error", (err) => {
  // Avoid double-logging connection errors: connectDB already logs failures.
  if (isConnecting) return;
  console.error("MongoDB error:", err);
});
