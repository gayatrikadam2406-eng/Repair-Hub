const jwt = require("jsonwebtoken");

function createRoleToken(identity, secret, role) {
    if (!secret) {
        throw new Error("JWT_SECRET is required to sign authentication tokens.");
    }

    return jwt.sign(
        {
            sub: String(identity.id),
            email: identity.email,
            role
        },
        secret,
        {
            algorithm: "HS256",
            expiresIn: "8h"
        }
    );
}

function createAdminToken(admin, secret) {
    return createRoleToken(admin, secret, "admin");
}

function createTechnicianToken(technician, secret) {
    return createRoleToken(technician, secret, "technician");
}

function requireRoles(...roles) {
    return function (req, res, next) {
        const secret = process.env.JWT_SECRET;

        if (!secret) {
            return res.status(503).json({
                message: "Authentication is not configured!"
            });
        }

        const authorization = req.headers.authorization || "";
        const [scheme, token] = authorization.split(" ");

        if (scheme !== "Bearer" || !token) {
            return res.status(401).json({ message: "Authentication required!" });
        }

        try {
            const identity = jwt.verify(token, secret, { algorithms: ["HS256"] });

            if (!roles.includes(identity.role)) {
                return res.status(403).json({ message: "Access denied!" });
            }

            req.auth = identity;
            return next();
        } catch (error) {
            return res.status(401).json({ message: "Invalid or expired authentication token!" });
        }
    };
}

const requireAdmin = requireRoles("admin");
const requireAdminOrTechnician = requireRoles("admin", "technician");

module.exports = {
    createAdminToken,
    createTechnicianToken,
    requireAdmin,
    requireAdminOrTechnician
};
