const nodemailer = require("nodemailer");

let transporter;

function getTransporter() {
    const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD } = process.env;
    const port = Number(EMAIL_PORT);

    if (!EMAIL_HOST || !Number.isInteger(port) || port < 1 || !EMAIL_USER || !EMAIL_PASSWORD) {
        throw new Error("SMTP email configuration is incomplete.");
    }

    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: EMAIL_HOST,
            port,
            secure: port === 465,
            auth: {
                user: EMAIL_USER,
                pass: EMAIL_PASSWORD
            }
        });
    }

    return transporter;
}

async function sendEmail({ to, subject, text, html }) {
    if (!process.env.EMAIL_FROM || !to) {
        throw new Error("Email sender or recipient is not configured.");
    }

    return getTransporter().sendMail({
        from: process.env.EMAIL_FROM,
        to,
        subject,
        text,
        // Optional HTML keeps existing text-only notifications compatible.
        ...(html ? { html } : {})
    });
}

module.exports = { sendEmail };