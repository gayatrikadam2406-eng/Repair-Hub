// Repair Hub - API Configuration
// Dynamically routes to localhost in development, /api on Vercel, and Render as fallback.
(function () {
    const isLocal =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.protocol === "file:";

    if (isLocal) {
        window.API_BASE_URL = "http://localhost:5000";
    } else if (window.location.hostname.includes("vercel.app")) {
        window.API_BASE_URL = window.location.origin + "/api";
    } else {
        window.API_BASE_URL = "https://repair-hub-backend.onrender.com";
    }
})();
