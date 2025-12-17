import express from "express";
import "dotenv/config";
import authRoutes from './routes/authRoutes.js';
import gameRoutes from './routes/gameRoutes.js'; 
import { connectDB } from "./lib/db.js";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;


app.use(cors());
 
app.use(express.json());


app.use("/api/auth", authRoutes);
app.use("/api/game", gameRoutes); 


app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});



app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
});


app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(` Server running on port ${PORT}`);
  connectDB();
});