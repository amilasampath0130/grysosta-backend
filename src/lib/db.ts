import mongoose from "mongoose";

export const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URL as string);

    console.log(`Database Connected: ${conn.connection.host}`);
    console.log(` Database Name: ${conn.connection.name}`);
  } catch (error: any) {
    console.error(" MongoDB connection error:", error.message);
    process.exit(1);
  }
};

mongoose.connection.on("disconnected", () => {
  console.log("MongoDB disconnected");
});

mongoose.connection.on("error", (err) => {
  console.error("MongoDB error:", err);
});
