const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("Falta DATABASE_URL en el .env");
}

const rawUrl = process.env.DATABASE_URL;
const dbUrl = rawUrl.includes("sslmode=")
  ? rawUrl
  : `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}sslmode=require`;

const pool = new Pool({
  connectionString: dbUrl,
  ssl: {
    rejectUnauthorized: false,
  },
});

module.exports = pool;