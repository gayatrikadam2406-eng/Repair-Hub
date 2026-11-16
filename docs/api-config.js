// Repair Hub - API Configuration
// Automatically routes to local backend in development and Render backend in production.
(function () {
    const isLocal =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.protocol === "file:";

    window.API_BASE_URL = isLocal
        ? "http://localhost:5000"
        : "https://repair-hub-backend.onrender.com";
})();
