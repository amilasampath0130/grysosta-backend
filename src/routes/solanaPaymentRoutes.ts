import express from "express";
import { verifySolanaPayment } from "../controllers/solanaPaymentController.js";

const router = express.Router();

router.post("/verify", verifySolanaPayment);

export default router;
