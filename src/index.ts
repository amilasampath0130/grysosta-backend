import express, { Application, Request, Response, NextFunction } from "express";
import "dotenv/config";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import { connectDB } from "./lib/db.js";
import userRoutes from "./routes/userRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import VendorRoutes from "./routes/vendorRoutes.js";
const app: Application = express();
const PORT: number = Number(process.env.PORT) || 5000;

app.use(express.json());
app.use(cors({ origin: "http://localhost:3000" }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/vendor", VendorRoutes);

//for admin routes
app.use("/api/admin", adminRoutes);
app.get("/api/health", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Server is running healthy",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Error:", err);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(` Server running on port ${PORT}`);
  connectDB();
});
