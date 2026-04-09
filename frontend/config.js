window.APP_CONFIG = {
  API_BASE_URL:
    location.hostname === "localhost"
      ? "http://localhost:3000"
      : "https://liga-backend-staging.onrender.com"
};