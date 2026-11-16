const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const { sendEmail } = require("./email");
const {
    createAdminToken,
    createTechnicianToken,
    requireAdmin,
    requireAdminOrTechnician
} = require("./auth");

const app = express();
const PORT = process.env.PORT || 5000;
const bookingStatuses = ["Pending", "Accepted", "In Progress", "Completed", "Rejected"];

function sendEmailNotification(message) {
    const requiredSettings = [
        "EMAIL_HOST",
        "EMAIL_PORT",
        "EMAIL_USER",
        "EMAIL_PASSWORD",
        "EMAIL_FROM"
    ];

    if (!message.to || requiredSettings.some((setting) => !process.env[setting])) {
        console.warn("Email notification skipped: email settings or recipient are missing.");
        return;
    }

    sendEmail(message).catch((error) => {
        console.error("Email notification failed:", error.message);
    });
}

function escapeHtml(value) {
    // Encode HTML syntax characters before adding customer values to the email.
    return String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    })[character]);
}

// ===============================
// MIDDLEWARE
// ===============================

app.use(cors({ origin: true }));
app.use(express.json());

// ===============================
// MYSQL DATABASE CONNECTION
// ===============================

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

let technicianPasswordHash;

function seedFirstAdmin() {
    const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

    if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
        console.warn("Admin bootstrap skipped; configure ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD.");
        return;
    }

    db.query("SELECT id FROM admins LIMIT 1", (err, admins) => {
        if (err) {
            console.log("Admin bootstrap check failed:", err.message);
            return;
        }

        if (admins.length > 0) {
            return;
        }

        bcrypt.hash(ADMIN_PASSWORD, 12, (hashError, hashedPassword) => {
            if (hashError) {
                console.log("Admin password hashing failed:", hashError.message);
                return;
            }

            db.query(
                "INSERT INTO admins (name, email, password, role) VALUES (?, ?, ?, 'admin')",
                [ADMIN_NAME, ADMIN_EMAIL, hashedPassword],
                (insertError) => {
                    if (insertError && insertError.code !== "ER_DUP_ENTRY") {
                        console.log("Admin bootstrap failed:", insertError.message);
                        return;
                    }

                    if (!insertError) {
                        console.log("First admin account created from environment configuration.");
                    }
                }
            );
        });
    });
}

// ===============================
// CHECK DATABASE CONNECTION
// ===============================

db.getConnection((err, connection) => {
    if (err) {
        console.log("Database connection failed:", err.message);
    } else {
        connection.query(`
            CREATE TABLE IF NOT EXISTS admins (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL DEFAULT 'admin',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `, (tableError) => {
            connection.release();

            if (tableError) {
                console.log("Admins table setup failed:", tableError.message);
                return;
            }

            console.log("MySQL Database Connected Successfully!");
            seedFirstAdmin();
        });
    }
});

// ===============================
// TEST ROUTE
// ===============================

app.get("/", (req, res) => {
    res.send("Repair Hub Backend is Running!");
});

// ===============================
// REGISTER API
// ===============================

app.post("/register", async (req, res) => {

    const {
        name,
        email,
        phone,
        address,
        password
    } = req.body;

    if (!name || !email || !phone || !address || !password) {
        return res.status(400).json({
            message: "Please fill all fields!"
        });
    }

    try {

        const hashedPassword = await bcrypt.hash(password, 10);

        const sql = `
            INSERT INTO users
            (name, email, phone, address, password)
            VALUES (?, ?, ?, ?, ?)
        `;

        db.query(
            sql,
            [
                name,
                email,
                phone,
                address,
                hashedPassword
            ],
            (err, result) => {

                if (err) {

                    console.log("Registration Error:", err);

                    if (err.code === "ER_DUP_ENTRY") {
                        return res.status(400).json({
                            message: "Email already registered!"
                        });
                    }

                    return res.status(500).json({
                        message: "Registration failed!"
                    });
                }

                sendEmailNotification({
                    to: process.env.ADMIN_EMAIL,
                    subject: "New Repair Hub customer registration",
                    text: [
                        "A new customer registered with Repair Hub.",
                        `Name: ${name}`,
                        `Email: ${email}`,
                        `Phone: ${phone}`,
                        `Address: ${address}`
                    ].join("\n")
                });
                sendEmailNotification({
                    to: email,
                    subject: "Welcome to Repair Hub",
                    text: `Hello ${name},\n\nYour Repair Hub account has been created successfully. Welcome!`
                });

                res.status(201).json({
                    message: "Registration successful!"
                });
            }
        );

    } catch (error) {

        console.log("Password Hash Error:", error);

        res.status(500).json({
            message: "Registration failed!"
        });
    }
});

// ===============================
// LOGIN API
// ===============================

app.post("/login", (req, res) => {

    const {
        email,
        password
    } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            message: "Please enter email and password!"
        });
    }

    const sql = `
        SELECT *
        FROM users
        WHERE email = ?
    `;

    db.query(
        sql,
        [email],
        async (err, results) => {

            if (err) {

                console.log("Login Error:", err);

                return res.status(500).json({
                    message: "Login failed!"
                });
            }

            if (results.length === 0) {

                return res.status(401).json({
                    message: "Invalid email or password!"
                });
            }

            const user = results[0];

            try {

                const passwordMatch = await bcrypt.compare(
                    password,
                    user.password
                );

                if (!passwordMatch) {

                    return res.status(401).json({
                        message: "Invalid email or password!"
                    });
                }

                delete user.password;

                res.json({
                    message: "Login successful!",
                    user: user
                });

            } catch (error) {

                console.log("Password Compare Error:", error);

                res.status(500).json({
                    message: "Login failed!"
                });
            }
        }
    );
});

// ===============================
// ADMIN LOGIN API
// ===============================

app.post("/admin-login", (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            message: "Please enter email and password!"
        });
    }

    if (!process.env.JWT_SECRET || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
        return res.status(503).json({
            message: "Admin authentication is not configured!"
        });
    }

    db.query(
        "SELECT id, name, email, password, role FROM admins WHERE email = ? LIMIT 1",
        [email],
        async (err, results) => {
            if (err) {
                console.log("Admin Login Error:", err);
                return res.status(500).json({ message: "Admin login failed!" });
            }

            if (results.length === 0 || results[0].role !== "admin") {
                return res.status(401).json({ message: "Invalid admin email or password." });
            }

            const admin = results[0];

            try {
                const passwordMatch = await bcrypt.compare(password, admin.password);

                if (!passwordMatch) {
                    return res.status(401).json({ message: "Invalid admin email or password." });
                }

                const token = createAdminToken(admin, process.env.JWT_SECRET);
                delete admin.password;

                return res.json({
                    message: "Admin login successful!",
                    token,
                    admin
                });
            } catch (error) {
                console.log("Admin Authentication Error:", error);
                return res.status(500).json({ message: "Admin login failed!" });
            }
        }
    );
});

// ===============================
// TECHNICIAN LOGIN API
// ===============================

app.post("/technician-login", async (req, res) => {
    const { email, password } = req.body;
    const { TECHNICIAN_NAME, TECHNICIAN_EMAIL, TECHNICIAN_PASSWORD, JWT_SECRET } = process.env;

    if (!email || !password) {
        return res.status(400).json({ message: "Please enter email and password!" });
    }

    if (!TECHNICIAN_NAME || !TECHNICIAN_EMAIL || !TECHNICIAN_PASSWORD || !JWT_SECRET) {
        return res.status(503).json({ message: "Technician authentication is not configured!" });
    }

    if (email.trim().toLowerCase() !== TECHNICIAN_EMAIL.trim().toLowerCase()) {
        return res.status(401).json({ message: "Invalid email or password!" });
    }

    try {
        technicianPasswordHash ??= await bcrypt.hash(TECHNICIAN_PASSWORD, 12);
        const passwordMatch = await bcrypt.compare(password, technicianPasswordHash);

        if (!passwordMatch) {
            return res.status(401).json({ message: "Invalid email or password!" });
        }

        const technician = {
            id: "environment-technician",
            name: TECHNICIAN_NAME,
            email: TECHNICIAN_EMAIL,
            role: "technician"
        };

        return res.json({
            message: "Technician login successful!",
            token: createTechnicianToken(technician, JWT_SECRET),
            technician
        });
    } catch (error) {
        console.log("Technician Authentication Error:", error);
        return res.status(500).json({ message: "Technician login failed!" });
    }
});

// ===============================
// BOOKING API
// ===============================

app.post("/book-service", (req, res) => {

    const {
        name,
        phone,
        email,
        address,
        service,
        booking_date,
        booking_time,
        problem
    } = req.body;

    if (
        !name ||
        !phone ||
        !email ||
        !address ||
        !service ||
        !booking_date ||
        !booking_time ||
        !problem
    ) {

        return res.status(400).json({
            message: "Please fill all booking details!"
        });
    }

    const sql = `
        INSERT INTO bookings
        (
            name,
            phone,
            email,
            address,
            service,
            booking_date,
            booking_time,
            problem
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(
        sql,
        [
            name,
            phone,
            email,
            address,
            service,
            booking_date,
            booking_time,
            problem
        ],
        (err, result) => {

            if (err) {

                console.log("Booking Error:", err);

                return res.status(500).json({
                    message: "Booking failed!"
                });
            }

            const bookingDetails = [
                `Customer: ${name}`,
                `Email: ${email}`,
                `Phone: ${phone}`,
                `Address: ${address}`,
                `Service: ${service}`,
                `Date: ${booking_date}`,
                `Time: ${booking_time}`,
                `Problem: ${problem}`
            ].join("\n");

            // Build the admin email after MySQL has returned the saved booking ID.
            const adminBookingDetails = [
                ["Customer name", name],
                ["Customer email", email],
                ["Customer phone number", phone],
                ["Repair service name", service],
                ["Booking ID", result.insertId],
                ["Booking date", booking_date],
                ["Customer address", address]
            ];
            const adminBookingText = [
                "New Repair Service Booking",
                "",
                ...adminBookingDetails.map(([label, value]) => `${label}: ${value}`)
            ].join("\n");
            const adminBookingRows = adminBookingDetails.map(([label, value]) => (
                `<tr><th style="padding:10px;text-align:left;border:1px solid #dddddd;background:#f5f5f5;">${escapeHtml(label)}</th><td style="padding:10px;border:1px solid #dddddd;">${escapeHtml(value)}</td></tr>`
            )).join("");

            sendEmailNotification({
                to: process.env.ADMIN_EMAIL,
                subject: "New Repair Service Booking - Repair Hub",
                text: adminBookingText,
                html: `<!doctype html>
<html>
<body style="margin:0;padding:24px;font-family:Arial,sans-serif;color:#222222;">
    <h1 style="font-size:22px;">New Repair Service Booking</h1>
    <p>A customer has booked a repair service. Details are below.</p>
    <table style="width:100%;max-width:640px;border-collapse:collapse;">${adminBookingRows}</table>
    <p style="margin-top:24px;color:#666666;">Repair Hub</p>
</body>
</html>`
            });
            sendEmailNotification({
                to: email,
                subject: "Repair Hub booking confirmation",
                text: `Hello ${name},\n\nYour booking has been received with status: Pending.\n\n${bookingDetails}`
            });

            res.status(201).json({
                message: "Booking successful!",
                bookingId: result.insertId
            });
        }
    );
});

// ===============================
// GET ALL BOOKINGS
// ===============================

app.get("/bookings", requireAdminOrTechnician, (req, res) => {

    const sql = `
        SELECT *
        FROM bookings
        ORDER BY created_at DESC
    `;

    db.query(sql, (err, results) => {

        if (err) {

            console.log("Fetch Bookings Error:", err);

            return res.status(500).json({
                message: "Failed to fetch bookings!"
            });
        }

        res.json(results);
    });
});

// ===============================
// UPDATE BOOKING STATUS
// ===============================

app.put("/booking-status/:id", requireAdminOrTechnician, (req, res) => {

    const bookingId = req.params.id;
    const { status } = req.body;

    if (!bookingStatuses.includes(status)) {

        return res.status(400).json({
            message: "Status must be Pending, Accepted, In Progress, Completed, or Rejected!"
        });
    }

    const sql = `
        UPDATE bookings
        SET status = ?
        WHERE id = ?
    `;

    db.query(
        sql,
        [status, bookingId],
        (err, result) => {

            if (err) {

                console.log("Status Update Error:", err);

                return res.status(500).json({
                    message: "Failed to update booking status!"
                });
            }

            if (result.affectedRows === 0) {

                return res.status(404).json({
                    message: "Booking not found!"
                });
            }

            res.json({
                message: "Booking status updated successfully!"
            });

            db.query(
                `
                SELECT name, email, service, booking_date, booking_time, status
                FROM bookings
                WHERE id = ?
                `,
                [bookingId],
                (lookupError, bookings) => {
                    if (lookupError) {
                        console.error("Email notification data lookup failed:", lookupError.message);
                        return;
                    }

                    if (bookings.length === 0) {
                        return;
                    }

                    const booking = bookings[0];
                    sendEmailNotification({
                        to: booking.email,
                        subject: "Repair Hub booking status update",
                        text: [
                            `Hello ${booking.name},`,
                            "",
                            `Your booking status is now: ${booking.status}.`,
                            `Service: ${booking.service}`,
                            `Date: ${booking.booking_date}`,
                            `Time: ${booking.booking_time}`
                        ].join("\n")
                    });
                }
            );
        }
    );
});

// ===============================
// GET BOOKING STATUS
// ===============================

app.get("/booking-status/:id", (req, res) => {

    const bookingId = req.params.id;

    const sql = `
        SELECT
            id,
            name,
            service,
            booking_date,
            booking_time,
            problem,
            status
        FROM bookings
        WHERE id = ?
    `;

    db.query(
        sql,
        [bookingId],
        (err, results) => {

            if (err) {

                console.log("Booking Status Error:", err);

                return res.status(500).json({
                    message: "Failed to get booking status!"
                });
            }

            if (results.length === 0) {

                return res.status(404).json({
                    message: "Booking not found!"
                });
            }

            res.json(results[0]);
        }
    );
});

// ===============================
// ADMIN STATISTICS
// ===============================

app.get("/admin-stats", requireAdmin, (req, res) => {

    const stats = {};

    // Total Users
    db.query(
        "SELECT COUNT(*) AS totalUsers FROM users",
        (err, userResult) => {

            if (err) {

                console.log("Users Count Error:", err);

                return res.status(500).json({
                    message: "Failed to get user statistics!"
                });
            }

            stats.totalUsers = userResult[0].totalUsers;

            // Total Bookings
            db.query(
                "SELECT COUNT(*) AS totalBookings FROM bookings",
                (err, bookingResult) => {

                    if (err) {

                        console.log("Bookings Count Error:", err);

                        return res.status(500).json({
                            message: "Failed to get booking statistics!"
                        });
                    }

                    stats.totalBookings =
                        bookingResult[0].totalBookings;

                    // Pending Bookings
                    db.query(
                        `
                        SELECT COUNT(*) AS pendingBookings
                        FROM bookings
                        WHERE status = 'Pending'
                        `,
                        (err, pendingResult) => {

                            if (err) {

                                console.log(
                                    "Pending Count Error:",
                                    err
                                );

                                return res.status(500).json({
                                    message:
                                        "Failed to get pending statistics!"
                                });
                            }

                            stats.pendingBookings =
                                pendingResult[0].pendingBookings;

                            // Completed Bookings
                            db.query(
                                `
                                SELECT COUNT(*) AS completedBookings
                                FROM bookings
                                WHERE status = 'Completed'
                                `,
                                (err, completedResult) => {

                                    if (err) {

                                        console.log(
                                            "Completed Count Error:",
                                            err
                                        );

                                        return res.status(500).json({
                                            message:
                                                "Failed to get completed statistics!"
                                        });
                                    }

                                    stats.completedBookings =
                                        completedResult[0]
                                            .completedBookings;

                                    res.json(stats);
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});

// ===============================
// ADMIN RECENT BOOKINGS
// ===============================

app.get("/admin-recent-bookings", requireAdmin, (req, res) => {

    const sql = `
        SELECT
            id,
            name,
            service,
            booking_date,
            booking_time,
            status
        FROM bookings
        ORDER BY created_at DESC
        LIMIT 10
    `;

    db.query(sql, (err, results) => {

        if (err) {

            console.log(
                "Recent Bookings Error:",
                err
            );

            return res.status(500).json({
                message: "Failed to fetch recent bookings!"
            });
        }

        res.json(results);
    });
});

// ===============================
// GET ALL USERS
// ===============================

app.get("/users", requireAdmin, (req, res) => {

    const sql = `
        SELECT
            id,
            name,
            email,
            phone,
            address
        FROM users
        ORDER BY id DESC
    `;

    db.query(sql, (err, results) => {

        if (err) {

            console.log("Fetch Users Error:", err);

            return res.status(500).json({
                message: "Failed to fetch users!"
            });
        }

        res.json(results);
    });
});

// ===============================
// START SERVER
// ===============================

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = { app, db };