import mongoose from "mongoose";
import User from "./src/models/User.js";
import "dotenv/config";

const listAdmins = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL!);

    const admins = await User.find({ role: "admin" }).select(
      "name email adminOtpSentAt",
    );

    console.log("📋 Admin Users in Database:");
    console.log("==========================");

    if (admins.length === 0) {
      console.log("No admin users found.");
    } else {
      admins.forEach((admin, index) => {
        console.log(`${index + 1}. ${admin.name} (${admin.email})`);
        if (admin.adminOtpSentAt) {
          const elapsed = Date.now() - new Date(admin.adminOtpSentAt).getTime();
          const minutesLeft = Math.max(
            0,
            Math.ceil((30 * 60 * 1000 - elapsed) / (60 * 1000)),
          );
          console.log(`   OTP Sent: ${admin.adminOtpSentAt.toLocaleString()}`);
          console.log(`   Cooldown remaining: ${minutesLeft} minutes`);
        } else {
          console.log(`   No OTP cooldown active`);
        }
        console.log("");
      });
    }
  } catch (error) {
    console.error("❌ Error listing admins:", error);
  } finally {
    await mongoose.disconnect();
  }
};

listAdmins();
