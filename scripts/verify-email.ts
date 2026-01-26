import "dotenv/config";
import nodemailer from "nodemailer";

async function main() {
  const rawUser = process.env.EMAIL_USER || "";
  const rawPass = process.env.EMAIL_PASS || "";
  const user = rawUser.trim();
  const pass = rawPass.replace(/\s+/g, "");

  if (!user || !pass) {
    console.error("Missing EMAIL_USER or EMAIL_PASS env variables.");
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  try {
    await transporter.verify();
    console.log("Email transport verified successfully for:", user);
  } catch (err) {
    console.error("Email transport verify failed:", err);
    process.exit(2);
  }
}

main();
