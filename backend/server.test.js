const assert = require("node:assert/strict");
const { once } = require("node:events");
const { after, before, test } = require("node:test");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const database = {
    users: [],
    admins: [],
    bookings: []
};
const sentEmails = [];
let emailDeliveryFails = false;
let emailTransportOptions;

let completeAdminSeed;
const adminSeeded = new Promise((resolve) => {
    completeAdminSeed = resolve;
});

const fakePool = {
    getConnection(callback) {
        process.nextTick(() => callback(null, {
            query(sql, done) {
                assert.match(sql, /CREATE TABLE IF NOT EXISTS admins/);
                process.nextTick(() => done(null));
            },
            release() {}
        }));
    },
    query(sql, values, callback) {
        if (typeof values === "function") {
            callback = values;
            values = [];
        }

        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        process.nextTick(() => {
            if (normalizedSql === "SELECT id FROM admins LIMIT 1") {
                callback(null, database.admins.slice(0, 1));
            } else if (normalizedSql.startsWith("INSERT INTO admins")) {
                const [name, email, password] = values;
                database.admins.push({
                    id: database.admins.length + 1,
                    name,
                    email,
                    password,
                    role: "admin"
                });
                callback(null, { insertId: database.admins.length });
                completeAdminSeed();
            } else if (normalizedSql.includes("FROM admins WHERE email = ?")) {
                callback(null, database.admins.filter((admin) => admin.email === values[0]));
            } else if (normalizedSql.includes("FROM users WHERE email = ?")) {
                callback(null, database.users
                    .filter((user) => user.email === values[0])
                    .map((user) => ({ ...user })));
            } else if (normalizedSql.startsWith("INSERT INTO users")) {
                const [name, email, phone, address, password] = values;
                database.users.push({
                    id: database.users.length + 1,
                    name,
                    email,
                    phone,
                    address,
                    password
                });
                callback(null, { insertId: database.users.length });
            } else if (normalizedSql.startsWith("INSERT INTO bookings")) {
                const [name, phone, email, address, service, booking_date, booking_time, problem] = values;
                database.bookings.push({
                    id: database.bookings.length + 1,
                    name,
                    phone,
                    email,
                    address,
                    service,
                    booking_date,
                    booking_time,
                    problem,
                    status: "Pending"
                });
                callback(null, { insertId: database.bookings.length });
            } else if (normalizedSql.includes("COUNT(*) AS totalUsers")) {
                callback(null, [{ totalUsers: 1 }]);
            } else if (normalizedSql.includes("COUNT(*) AS totalBookings")) {
                callback(null, [{ totalBookings: 1 }]);
            } else if (normalizedSql.includes("COUNT(*) AS pendingBookings")) {
                callback(null, [{ pendingBookings: 1 }]);
            } else if (normalizedSql.includes("COUNT(*) AS completedBookings")) {
                callback(null, [{ completedBookings: 0 }]);
            } else if (normalizedSql.startsWith("UPDATE bookings")) {
                const booking = database.bookings.find(({ id }) => String(id) === String(values[1]));
                if (booking) {
                    booking.status = values[0];
                }
                callback(null, { affectedRows: 1 });
            } else if (normalizedSql.includes("FROM bookings WHERE id = ?")) {
                callback(null, database.bookings
                    .filter(({ id }) => String(id) === String(values[0]))
                    .map(({ name, email, service, booking_date, booking_time, status }) => ({
                        name,
                        email,
                        service,
                        booking_date,
                        booking_time,
                        status
                    })));
            } else if (normalizedSql.startsWith("CREATE TABLE IF NOT EXISTS")) {
                callback(null, {});
            } else if (normalizedSql === "SELECT id FROM technicians LIMIT 1") {
                callback(null, []);
            } else if (normalizedSql.includes("FROM technicians WHERE LOWER(email) = ?")) {
                callback(null, []);
            } else if (normalizedSql.includes("FROM admins WHERE LOWER(email) = ?")) {
                callback(null, []);
            } else if (normalizedSql.includes("FROM bookings")) {
                callback(null, database.bookings);
            } else if (normalizedSql.includes("FROM users")) {
                callback(null, database.users.map(({ id, name, email, phone, address }) => ({
                    id,
                    name,
                    email,
                    phone,
                    address
                })));
            } else {
                callback(new Error(`Unexpected test query: ${normalizedSql}`));
            }
        });
    }
};

const envKeys = [
    "JWT_SECRET",
    "ADMIN_NAME",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD",
    "TECHNICIAN_NAME",
    "TECHNICIAN_EMAIL",
    "TECHNICIAN_PASSWORD",
    "EMAIL_HOST",
    "EMAIL_PORT",
    "EMAIL_USER",
    "EMAIL_PASSWORD",
    "EMAIL_FROM"
];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
let server;
let baseUrl;
let adminToken;
let technicianToken;

before(async () => {
    process.env.JWT_SECRET = "repair-hub-auth-test-secret";
    process.env.ADMIN_NAME = "Test Admin";
    process.env.ADMIN_EMAIL = "admin@example.test";
    process.env.ADMIN_PASSWORD = "test-admin-password";
    process.env.TECHNICIAN_NAME = "Test Technician";
    process.env.TECHNICIAN_EMAIL = "technician@example.test";
    process.env.TECHNICIAN_PASSWORD = "test-technician-password";
    process.env.EMAIL_HOST = "smtp.example.test";
    process.env.EMAIL_PORT = "587";
    process.env.EMAIL_USER = "smtp-user";
    process.env.EMAIL_PASSWORD = "smtp-password";
    process.env.EMAIL_FROM = "Repair Hub <noreply@example.test>";

    database.users.push({
        id: 21,
        name: "Test Customer",
        email: "customer@example.test",
        phone: "5550100",
        address: "Test address",
        password: await bcrypt.hash("test-customer-password", 4)
    });

    const mysqlPath = require.resolve("mysql2");
    const originalMysql = require.cache[mysqlPath];
    const nodemailerPath = require.resolve("nodemailer");
    const originalNodemailer = require.cache[nodemailerPath];
    require.cache[mysqlPath] = {
        id: mysqlPath,
        filename: mysqlPath,
        loaded: true,
        exports: { createPool: () => fakePool }
    };
    require.cache[nodemailerPath] = {
        id: nodemailerPath,
        filename: nodemailerPath,
        loaded: true,
        exports: {
            createTransport(options) {
                emailTransportOptions = options;
                return {
                    async sendMail(message) {
                        sentEmails.push({
                            ...message,
                            usersAtSend: database.users.map(({ email }) => email),
                            bookingStatusesAtSend: database.bookings.map(({ status }) => status)
                        });

                        if (emailDeliveryFails) {
                            throw new Error("mock SMTP failure");
                        }

                        return { accepted: [message.to] };
                    }
                };
            }
        }
    };

    const { app } = require("./server");

    if (originalMysql) {
        require.cache[mysqlPath] = originalMysql;
    } else {
        delete require.cache[mysqlPath];
    }
    if (originalNodemailer) {
        require.cache[nodemailerPath] = originalNodemailer;
    } else {
        delete require.cache[nodemailerPath];
    }

    await adminSeeded;
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) {
        server.close();
        await once(server, "close");
    }

    for (const key of envKeys) {
        if (originalEnv[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = originalEnv[key];
        }
    }
});

async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, options);
    return { status: response.status, data: await response.json() };
}

function jsonOptions(method, body, token) {
    return {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    };
}

test("customer login verifies bcrypt hashes from users and issues no admin token", async () => {
    const valid = await request("/login", jsonOptions("POST", {
        email: "customer@example.test",
        password: "test-customer-password"
    }));
    assert.equal(valid.status, 200);
    assert.equal(valid.data.user.email, "customer@example.test");
    assert.equal(valid.data.token, undefined);

    const invalid = await request("/login", jsonOptions("POST", {
        email: "customer@example.test",
        password: "wrong-password"
    }));
    assert.equal(invalid.status, 401);
});

test("first admin is seeded with bcrypt and admin login issues a JWT", async () => {
    assert.equal(database.admins.length, 1);
    assert.notEqual(database.admins[0].password, process.env.ADMIN_PASSWORD);
    assert.equal(
        await bcrypt.compare(process.env.ADMIN_PASSWORD, database.admins[0].password),
        true
    );

    const customerCannotAdminLogin = await request("/admin-login", jsonOptions("POST", {
        email: "customer@example.test",
        password: "test-customer-password"
    }));
    assert.equal(customerCannotAdminLogin.status, 401);
    assert.equal(customerCannotAdminLogin.data.message, "Invalid admin email or password.");

    const invalid = await request("/admin-login", jsonOptions("POST", {
        email: process.env.ADMIN_EMAIL,
        password: "wrong-password"
    }));
    assert.equal(invalid.status, 401);
    assert.equal(invalid.data.message, "Invalid admin email or password.");

    const valid = await request("/admin-login", jsonOptions("POST", {
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD
    }));
    assert.equal(valid.status, 200);
    assert.equal(valid.data.admin.password, undefined);
    assert.equal(jwt.verify(valid.data.token, process.env.JWT_SECRET).role, "admin");
    assert.equal(jwt.verify(valid.data.token, process.env.JWT_SECRET).email, process.env.ADMIN_EMAIL);
    adminToken = valid.data.token;
});

test("admin login reports missing environment credentials", async () => {
    const configuredEmail = process.env.ADMIN_EMAIL;
    const configuredPassword = process.env.ADMIN_PASSWORD;

    try {
        delete process.env.ADMIN_EMAIL;
        const missingEmail = await request("/admin-login", jsonOptions("POST", {
            email: "admin@example.test",
            password: "test-admin-password"
        }));
        assert.equal(missingEmail.status, 503);
        assert.equal(missingEmail.data.message, "Admin authentication is not configured!");

        process.env.ADMIN_EMAIL = configuredEmail;
        delete process.env.ADMIN_PASSWORD;
        const missingPassword = await request("/admin-login", jsonOptions("POST", {
            email: configuredEmail,
            password: "test-admin-password"
        }));
        assert.equal(missingPassword.status, 503);
        assert.equal(missingPassword.data.message, "Admin authentication is not configured!");
    } finally {
        process.env.ADMIN_EMAIL = configuredEmail;
        process.env.ADMIN_PASSWORD = configuredPassword;
    }
});

test("technician login issues a technician JWT and rejects invalid credentials", async () => {
    const invalid = await request("/technician-login", jsonOptions("POST", {
        email: process.env.TECHNICIAN_EMAIL,
        password: "wrong-password"
    }));
    assert.equal(invalid.status, 401);

    const valid = await request("/technician-login", jsonOptions("POST", {
        email: process.env.TECHNICIAN_EMAIL,
        password: process.env.TECHNICIAN_PASSWORD
    }));
    assert.equal(valid.status, 200);
    assert.equal(valid.data.technician.role, "technician");
    assert.equal(jwt.verify(valid.data.token, process.env.JWT_SECRET).role, "technician");

    const technicianCanUpdateJobStatus = await request(
        "/booking-status/1",
        jsonOptions("PUT", { status: "Completed" }, valid.data.token)
    );
    assert.equal(technicianCanUpdateJobStatus.status, 200);
    technicianToken = valid.data.token;

    const technicianCannotAccessAdminData = await request("/users", {
        headers: { Authorization: `Bearer ${valid.data.token}` }
    });
    assert.equal(technicianCannotAccessAdminData.status, 403);
});

test("admin endpoints reject customers and accept authenticated admins", async () => {
    const customerToken = jwt.sign(
        { sub: "21", email: "customer@example.test", role: "customer" },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
    );
    const protectedRequests = [
        ["/users", { method: "GET" }],
        ["/bookings", { method: "GET" }],
        ["/admin-stats", { method: "GET" }],
        ["/admin-recent-bookings", { method: "GET" }],
        ["/booking-status/1", jsonOptions("PUT", { status: "Completed" })]
    ];

    for (const [path, options] of protectedRequests) {
        assert.equal((await request(path, options)).status, 401, `${path} must reject no token`);
        assert.equal(
            (await request(path, {
                ...options,
                headers: { ...options.headers, Authorization: `Bearer ${customerToken}` }
            })).status,
            403,
            `${path} must reject a customer token`
        );
    }

    for (const [path, options] of protectedRequests) {
        const result = await request(path, {
            ...options,
            headers: { ...options.headers, Authorization: `Bearer ${adminToken}` }
        });
        assert.equal(result.status, 200, `${path} must accept an admin token`);
    }
});

test("registration, booking, and status updates send post-save notifications", async () => {
    sentEmails.length = 0;
    emailDeliveryFails = false;
    const bookingCustomerName = 'New Customer <script>alert("x")</script>';

    const registration = await request("/register", jsonOptions("POST", {
        name: "New Customer",
        email: "new-customer@example.test",
        phone: "5550199",
        address: "99 Test Road",
        password: "new-customer-password"
    }));
    assert.equal(registration.status, 201);

    const booking = await request("/book-service", jsonOptions("POST", {
        name: bookingCustomerName,
        phone: "5550199",
        email: "new-customer@example.test",
        address: "99 Test Road",
        service: "Laptop repair",
        booking_date: "2026-10-10",
        booking_time: "10:30",
        problem: "The screen is damaged"
    }));
    assert.equal(booking.status, 201);

    await new Promise(setImmediate);
    assert.equal(sentEmails.length, 4);
    const registrationNotice = sentEmails.find(({ subject }) => subject === "New Repair Hub customer registration");
    const welcome = sentEmails.find(({ subject }) => subject === "Welcome to Repair Hub");
    const bookingNotice = sentEmails.find(({ subject }) => subject === "New Repair Service Booking - Repair Hub");
    const confirmation = sentEmails.find(({ subject }) => subject === "Repair Hub booking confirmation");

    assert.equal(registrationNotice.to, process.env.ADMIN_EMAIL);
    assert.match(registrationNotice.text, /New Customer[\s\S]*new-customer@example\.test[\s\S]*5550199[\s\S]*99 Test Road/);
    assert.ok(registrationNotice.usersAtSend.includes("new-customer@example.test"));
    assert.equal(welcome.to, "new-customer@example.test");

    assert.equal(bookingNotice.to, process.env.ADMIN_EMAIL);
    assert.equal(bookingNotice.subject, "New Repair Service Booking - Repair Hub");
    assert.ok(bookingNotice.text.includes(`Customer name: ${bookingCustomerName}`));
    assert.ok(bookingNotice.text.includes("Customer email: new-customer@example.test"));
    assert.ok(bookingNotice.text.includes("Customer phone number: 5550199"));
    assert.ok(bookingNotice.text.includes("Repair service name: Laptop repair"));
    assert.ok(bookingNotice.text.includes(`Booking ID: ${booking.data.bookingId}`));
    assert.ok(bookingNotice.text.includes("Booking date: 2026-10-10"));
    assert.ok(bookingNotice.text.includes("Customer address: 99 Test Road"));
    assert.match(bookingNotice.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
    assert.doesNotMatch(bookingNotice.html, /<script>/);
    assert.ok(bookingNotice.bookingStatusesAtSend.includes("Pending"));
    assert.equal(confirmation.to, "new-customer@example.test");

    const statusUpdate = await request(
        `/booking-status/${booking.data.bookingId}`,
        jsonOptions("PUT", { status: "In Progress" }, technicianToken)
    );
    assert.equal(statusUpdate.status, 200);

    const invalidStatus = await request(
        `/booking-status/${booking.data.bookingId}`,
        jsonOptions("PUT", { status: "On Hold" }, adminToken)
    );
    assert.equal(invalidStatus.status, 400);

    await new Promise(setImmediate);

    assert.equal(sentEmails.length, 5);
    assert.equal(emailTransportOptions.host, process.env.EMAIL_HOST);
    assert.equal(emailTransportOptions.port, 587);
    assert.equal(emailTransportOptions.secure, false);
    assert.equal(emailTransportOptions.auth.user, process.env.EMAIL_USER);
    assert.equal(sentEmails[0].from, process.env.EMAIL_FROM);

    const statusNotice = sentEmails.find(({ subject }) => subject === "Repair Hub booking status update");

    assert.equal(statusNotice.to, "new-customer@example.test");
    assert.match(statusNotice.text, /In Progress/);
    assert.equal(database.bookings[0].status, "In Progress");
    assert.ok(statusNotice.bookingStatusesAtSend.includes("In Progress"));
});

test("SMTP failures are logged but do not fail saved customer, booking, or status changes", async () => {
    sentEmails.length = 0;
    emailDeliveryFails = true;
    const loggedEmailErrors = [];
    const originalConsoleError = console.error;
    console.error = (...args) => loggedEmailErrors.push(args);

    try {
        const registration = await request("/register", jsonOptions("POST", {
            name: "Mail Failure Customer",
            email: "mail-failure@example.test",
            phone: "5550123",
            address: "123 Email Lane",
            password: "mail-failure-password"
        }));
        assert.equal(registration.status, 201);

        const booking = await request("/book-service", jsonOptions("POST", {
            name: "Mail Failure Customer",
            phone: "5550123",
            email: "mail-failure@example.test",
            address: "123 Email Lane",
            service: "Phone repair",
            booking_date: "2026-10-11",
            booking_time: "11:30",
            problem: "The device will not start"
        }));
        assert.equal(booking.status, 201);
        await new Promise(setImmediate);
        assert.equal(loggedEmailErrors.length, 4);
        assert.ok(database.bookings.some(({ email }) => email === "mail-failure@example.test"));

        const statusUpdate = await request(
            `/booking-status/${booking.data.bookingId}`,
            jsonOptions("PUT", { status: "Rejected" }, adminToken)
        );
        assert.equal(statusUpdate.status, 200);

        await new Promise(setImmediate);

        assert.equal(sentEmails.length, 5);
        assert.equal(loggedEmailErrors.length, 5);
        assert.ok(loggedEmailErrors.every(([label]) => label === "Email notification failed:"));
        assert.ok(database.users.some(({ email }) => email === "mail-failure@example.test"));
        assert.ok(database.bookings.some(({ email, status }) => (
            email === "mail-failure@example.test" && status === "Rejected"
        )));
    } finally {
        console.error = originalConsoleError;
        emailDeliveryFails = false;
    }
});

test("booking succeeds and skips email when email settings are missing", async () => {
    sentEmails.length = 0;
    const originalEmailHost = process.env.EMAIL_HOST;
    const loggedWarnings = [];
    const originalConsoleWarn = console.warn;
    delete process.env.EMAIL_HOST;
    console.warn = (...args) => loggedWarnings.push(args);

    try {
        const booking = await request("/book-service", jsonOptions("POST", {
            name: "No Email Settings Customer",
            phone: "5550111",
            email: "no-email-settings@example.test",
            address: "1 Test Street",
            service: "Laptop repair",
            booking_date: "2026-10-12",
            booking_time: "12:30",
            problem: "The screen is damaged"
        }));

        assert.equal(booking.status, 201);
        assert.equal(booking.data.message, "Booking successful!");
        await new Promise(setImmediate);
        assert.equal(sentEmails.length, 0);
        assert.ok(loggedWarnings.length > 0);
        assert.ok(database.bookings.some(({ email }) => email === "no-email-settings@example.test"));
    } finally {
        process.env.EMAIL_HOST = originalEmailHost;
        console.warn = originalConsoleWarn;
    }
});
