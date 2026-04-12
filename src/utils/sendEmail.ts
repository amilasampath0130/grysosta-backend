import nodemailer from "nodemailer";

export const sendEmail = async (to: string, subject: string, html: string) => {
  const rawUser = process.env.EMAIL_USER || "";
  const rawPass = process.env.EMAIL_PASS || "";

  // Trim accidental whitespace (e.g., spaced app passwords)
  const user = rawUser.trim();
  const pass = rawPass.replace(/\s+/g, "");

  if (!user || !pass) {
    throw new Error(
      "Email credentials missing: set EMAIL_USER and EMAIL_PASS in environment",
    );
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  // Optional verification to surface credential/config errors early
  try {
    await transporter.verify();
    console.info("[EMAIL VERIFY SUCCESS]", { to, subject });
  } catch (err) {
    console.error("[EMAIL VERIFY ERROR]", {
      to,
      subject,
      error: err,
    });
    throw err;
  }

  try {
    await transporter.sendMail({
      from: `"Admin Security" <${user}>`,
      to,
      subject,
      html,
    });

    console.info("[EMAIL SEND SUCCESS]", { to, subject });
  } catch (err) {
    console.error("[EMAIL SEND ERROR]", {
      to,
      subject,
      error: err,
    });
    throw err;
  }
};
