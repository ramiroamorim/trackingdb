const { Pool } = require('pg');

const pool = new Pool({

    host: process.env.DB_HOST || 'postgres',
    port: process.env.DB_PORT ||  5432,
    database: process.env.DB_NAME || 'trackingdb',
    user: process.env.DB_USER || 'ramiro',
    password: process.env.DB_PASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,


})


pool.on('connect', () => {
    console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
});

module.exports = pool;