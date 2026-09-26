const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 5000;

// ===============================
// MIDDLEWARE
// ===============================

app.use(cors());
app.use(express.json());

// ===============================
// MYSQL DATABASE CONNECTION
// ===============================

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306
});

// ===============================
// CHECK DATABASE CONNECTION
// ===============================

db.connect((err) => {
    if (err) {
        console.log("Database connection failed:", err.message);
    } else {
        console.log("MySQL Database Connected Successfully!");
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

app.get("/bookings", (req, res) => {

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

app.put("/booking-status/:id", (req, res) => {

    const bookingId = req.params.id;
    const { status } = req.body;

    if (!status) {

        return res.status(400).json({
            message: "Status is required!"
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

app.get("/admin-stats", (req, res) => {

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

app.get("/admin-recent-bookings", (req, res) => {

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

app.get("/users", (req, res) => {

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

app.listen(PORT, () => {

    console.log(
        `Server running at http://localhost:${PORT}`
    );

});