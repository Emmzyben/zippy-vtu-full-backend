const fetch = require("node-fetch");

async function sendEmail(toEmail, subject, message) {
  try {
    const response = await fetch("https://www.zippypay.ng/send_email.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: toEmail,
        subject: subject,
        message: message,
      }),
    });

    const result = await response.json();

    if (result.status === "success") {
      console.log("✅ Email sent successfully:", result.message);
      return true;
    } else {
      console.error("❌ Failed to send email:", result.message);
      return false;
    }
  } catch (error) {
    console.error("🌐 Network error while sending email:", error.message);
    return false;
  }
}

module.exports = sendEmail;
