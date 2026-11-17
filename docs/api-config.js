// Repair Hub - API Configuration
// Dynamically routes to localhost in development, /api on Vercel, and handles GitHub Pages or external hosts cleanly.
(function () {
    const hostname = window.location.hostname;
    const isLocal =
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        window.location.protocol === "file:";

    if (isLocal) {
        window.API_BASE_URL = "http://localhost:5000";
    } else if (hostname.includes("vercel.app") || window.location.pathname.startsWith("/api")) {
        window.API_BASE_URL = window.location.origin + "/api";
    } else if (hostname.includes("github.io")) {
        window.API_BASE_URL = "https://repair-hub-eta.vercel.app/api";
    } else {
        window.API_BASE_URL = window.location.origin + "/api";
    }
})();
