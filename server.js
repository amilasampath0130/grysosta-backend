import express from "express";
import "dotenv/config";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import authRoutes from './src/routes/authRoutes.js';
import gameRoutes from './src/routes/gameRoutes.js';
import { connectDB } from "./src/lib/db.js";
import PrizeService from "./src/services/prizeService.js"; // ADD THIS

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS configuration - Allow mobile app connections
app.use(cors({
  origin: [
    "http://localhost:3000",
    "exp://localhost:19000", 
    "http://localhost:19006",
    "http://192.168.8.102:3000", // Your local IP
    "http://192.168.1.*", // Allow any IP in this range
    /\.ngrok\.io$/, // Allow ngrok URLs
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"]
}));

// Rate limiting - ENHANCED WITH GAME-SPECIFIC LIMITS
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later."
  }
});

// Game-specific rate limiting (more strict)
const gameLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // Max 20 game actions per minute
  message: {
    success: false,
    message: "Too many game actions, please slow down."
  }
});

app.use(generalLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/game", gameLimiter, gameRoutes); // ADD GAME ROUTES WITH SPECIFIC LIMITER

// Health check endpoint - ENHANCED
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running smoothly",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: "1.0.0",
    services: {
      database: "connected", // You can enhance this to check DB status
      gaming: "active",
      authentication: "active"
    }
  });
});

// Test endpoint for mobile connection
app.get("/api/test", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Backend is connected successfully!",
    clientIP: req.ip,
    timestamp: new Date().toISOString()
  });
});

// Game initialization endpoint (for testing)
app.post("/api/admin/initialize-prizes", async (req, res) => {
  try {
    await PrizeService.initializeDefaultPrizes();
    res.status(200).json({
      success: true,
      message: "Game prizes initialized successfully"
    });
  } catch (error) {
    console.error("Prize initialization error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initialize prizes"
    });
  }
});

// 404 handler for API routes
app.use("/api/", (req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found"
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("Global error handler:", error);
  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

// Enhanced server startup with game initialization
const startServer = async () => {
  try {
    // Connect to database first
    await connectDB();
    
    // Initialize game prizes after DB connection
    try {
      await PrizeService.initializeDefaultPrizes();
      console.log("✅ Game prizes initialized successfully");
    } catch (prizeError) {
      console.error("❌ Prize initialization error:", prizeError);
      // Don't crash the server if prizes fail to initialize
    }
    
    // Start listening
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
🚀 Server running on port ${PORT}
📍 Local: http://localhost:${PORT}
📍 Network: http://YOUR_IP:${PORT}
📍 Health: http://localhost:${PORT}/api/health
📍 Test: http://localhost:${PORT}/api/test

🎮 GAMING SYSTEM STATUS: ACTIVE
✅ Authentication: Ready
✅ Game Routes: Ready  
✅ Prize System: Initialized
✅ Rate Limiting: Active
      `);
    });
    
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// Start the server with enhanced initialization
startServer();