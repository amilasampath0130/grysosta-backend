import sgMail from "@sendgrid/mail";

export const sendEmail = async (to: string, subject: string, html: string) => {
  const apiKey = process.env.SENDGRID_API_KEY?.trim() || "";
  const from =
    process.env.EMAIL_FROM?.trim() ||
    process.env.SENDGRID_FROM_EMAIL?.trim() ||
    "";

  if (!apiKey || !from) {
    throw new Error(
      "SendGrid configuration missing: set SENDGRID_API_KEY and EMAIL_FROM in environment",
    );
  }

  sgMail.setApiKey(apiKey);

  try {
    await sgMail.send({
      to,
      from,
      subject,
      html,
    });

    console.info("[EMAIL SEND SUCCESS]", { to, subject });
  } catch (err) {
    console.error("[EMAIL SEND ERROR]", {
      to,
      subject,
      from,
      error: err,
    });
    throw err;
  }
};
