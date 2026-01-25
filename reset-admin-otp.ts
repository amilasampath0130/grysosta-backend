import mongoose from "mongoose";
import User from "./src/models/User.js";
import "dotenv/config";

const resetAdminOtpCooldown = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL!);

    const admin = await User.findOne({
      email: "admin@grysosta.com",
      role: "admin",
    });

    if (!admin) {
      console.log("Admin user not found");
      process.exit(1);
    }

    // Reset OTP cooldown
    admin.adminOtp = undefined;
    admin.adminOtpExpires = undefined;
    admin.adminOtpSentAt = undefined;

    await admin.save();
    console.log("✅ Admin OTP cooldown reset successfully!");
    console.log("You can now login again immediately.");
  } catch (error) {
    console.error("❌ Error resetting admin OTP cooldown:", error);
  } finally {
    await mongoose.disconnect();
  }
};

resetAdminOtpCooldown();
