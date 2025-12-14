const express = require('express');
const cors = require('cors');
const { Queue } = require('bullmq');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const IORedis = require('ioredis');

const app = express();

app.set('trust proxy', 1);

// --- CONFIGURAÇÃO DO REDIS ---
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const redisConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null
});

let queue;
function getQueue() {
    if (queue) return queue;
    queue = new Queue('analytics', { connection: redisConnection });
    console.log('🚀 Queue conectada em:', REDIS_URL);
    return queue;
}

// --- CONFIGURAÇÃO DO CORS ---
app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://ramiroamorim.com.br',
        process.env.FRONTEND_URL
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'] 
    // Removi o 'x-api-key' daqui pois não vamos mais usar
}));

app.use(express.json({ limit: '1mb' }));

// Rate limiting (Proteção contra muitos cliques rápidos)
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { ok: false, error: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false }
});

// --- SCHEMA DE VALIDAÇÃO (JOI) ---
const eventSchema = Joi.object({
    name: Joi.string().max(100),
    event_name: Joi.string().max(100),
    event_id: Joi.string().max(255),
    event_time: Joi.number().integer().positive(),
    fbp: Joi.string().max(255),
    fbc: Joi.string().max(255),
    external_id: Joi.string().max(255),
    value: Joi.number().positive(),
    currency: Joi.string().length(3).uppercase(),
    content_name: Joi.string().max(255),
    content_category: Joi.string().max(255),
    product_name: Joi.string().max(255),
    userAgent: Joi.string().max(500),
    clientIpAddress: Joi.string().ip({ version: ['ipv4', 'ipv6'] }),
    email: Joi.string().email().max(255),
    phone: Joi.string().max(50),
    first_name: Joi.string().max(100),
    last_name: Joi.string().max(100),
    instagram: Joi.string().max(100),
    city: Joi.string().max(100),
    state: Joi.string().max(50),
    zip: Joi.string().max(20),
    country: Joi.string().max(10),
    latitude: Joi.number(),
    longitude: Joi.number(),
    continent_code: Joi.string().max(2),
    continent_name: Joi.string().max(50),
    country_name: Joi.string().max(100),
    region_name: Joi.string().max(100),
    timezone: Joi.string().max(50),
    timezone_offset: Joi.string().max(10),
    currency_code: Joi.string().length(3).uppercase(),
    currency_symbol: Joi.string().max(10),
    language: Joi.string().max(10),
    isp: Joi.string().max(255),
    asn: Joi.number().integer(),
    connection_type: Joi.string().max(50),
    is_proxy: Joi.boolean(),
    is_vpn: Joi.boolean(),
    is_tor_exit_node: Joi.boolean(),
    security_threat: Joi.string().max(20),
    is_mobile: Joi.boolean(),
    is_tablet: Joi.boolean(),
    browser: Joi.string().max(50),
    browser_version: Joi.string().max(50),
    os: Joi.string().max(50),
    platform: Joi.string().max(50),
    lead_data: Joi.object(),
    scheduling: Joi.object(),
    userData: Joi.object(),
    props: Joi.object()
}).or('name', 'event_name');

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Transformação de dados (Fillout)
const transformFilloutPayload = (req, res, next) => {
    if (req.body.submissionId && req.body.data) {
        const filloutData = req.body.data;
        req.body = {
            event_name: 'Lead',
            email: filloutData.email,
            phone: filloutData.phone || filloutData.telefone,
            first_name: filloutData.name?.split(' ')[0] || filloutData.nome?.split(' ')[0],
            last_name: filloutData.name?.split(' ').slice(1).join(' '),
            external_id: req.body.submissionId,
            lead_data: filloutData
        };
        console.log(' Payload transformed from Fillout');
    }
    next();
};

// --- ROTA PRINCIPAL (SEM API KEY AGORA) ---
// Removi o 'authenticateApiKey' daqui
app.post('/api/event', transformFilloutPayload, apiLimiter, async (req, res) => {
    try {
        const body = req.body || {};

        const { error, value } = eventSchema.validate(body, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const errors = error.details.map(d => d.message);
            console.warn(' Validation error:', errors);
            return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
        }

        const enrichedPayload = {
            ...value,
            userAgent: req.headers['user-agent'] || value.userAgent,
            clientIpAddress: req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || value.clientIpAddress
        };

        const q = getQueue();

        await q.add('track_event', enrichedPayload, {
            removeOnComplete: true,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 }
        });

        console.log(' Enqueued event:', enrichedPayload.name || enrichedPayload.event_name);
        return res.json({ ok: true });

    } catch (err) {
        console.error(' Enqueue error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
