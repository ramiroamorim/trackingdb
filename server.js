const express = require('express');
const cors = require('cors');
const { Queue } = require('bullmq');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');

const app = express();

// Confiar em proxies para pegar o IP real do cliente
app.set('trust proxy', true);

// Configurar CORS ANTES de outros middlewares
app.use(cors({
    origin: [
        'http://localhost:3000',
        process.env.FRONTEND_URL // URL específica do seu frontend
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS']
}));

// Limitar tamanho do request para prevenir ataques
app.use(express.json({ limit: '1mb' }));

// Rate limiting para prevenir abuso
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 100, // máximo 100 requests por minuto por IP
    message: { ok: false, error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    // Validar trust proxy para evitar bypass
    validate: { trustProxy: false }
});

// Middleware de autenticação com API Key
const authenticateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const validApiKey = process.env.API_KEY;

    // Se API_KEY não estiver configurada, apenas loggar warning mas permitir
    if (!validApiKey) {
        console.warn('WARNING: API_KEY not configured - authentication disabled');
        return next();
    }

    if (!apiKey || apiKey !== validApiKey) {
        return res.status(401).json({ ok: false, error: 'Unauthorized - Invalid API Key' });
    }

    next();
};

// Schema de validação para eventos
const eventSchema = Joi.object({
  // Básico do evento
  name: Joi.string().max(100),
  event_name: Joi.string().max(100),
  event_id: Joi.string().max(255),
  event_time: Joi.number().integer().positive(),

  // Meta / Pixel
  fbp: Joi.string().max(255),
  fbc: Joi.string().max(255),
  external_id: Joi.string().max(255),

  // Dados de valor / produto
  value: Joi.number().positive(),
  currency: Joi.string().length(3).uppercase(),
  content_name: Joi.string().max(255),
  content_category: Joi.string().max(255),
  product_name: Joi.string().max(255),

  // HTTP / device básico
  userAgent: Joi.string().max(500),
  clientIpAddress: Joi.string().ip({ version: ['ipv4', 'ipv6'] }),

  // Dados de identificação
  email: Joi.string().email().max(255),
  phone: Joi.string().max(50),
  first_name: Joi.string().max(100),
  last_name: Joi.string().max(100),
  instagram: Joi.string().max(100),

  // GEO / localização
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

  // Moeda extra
  currency_code: Joi.string().length(3).uppercase(),
  currency_symbol: Joi.string().max(10),

  // Network / device avançado
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

  // JSONB extras
  lead_data: Joi.object(),
  scheduling: Joi.object(),

  // Campos genéricos que você já usava
  userData: Joi.object(),
  props: Joi.object()
}).or('name', 'event_name'); // Pelo menos um dos dois é obrigatório



const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let queue;
function getQueue() {
    if (queue) return queue;
    queue = new Queue('analytics', { connection: { url: REDIS_URL }});
    console.log('Queue created, redis:', REDIS_URL);
    return queue;
}

app.get('/api/health', (req, res) => res.json({ ok: true }));


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
            lead_data: filloutData // JSONB

};

  console.log('payload transformed:', req.body.event_name);
}
  
  next();

};




// Aplicar rate limiting e autenticação no endpoint de eventos
app.post('/api/event',transformFilloutPayload, apiLimiter, authenticateApiKey, async (req, res) => {
    try {
        const body = req.body || {};

        // Validar payload
        const { error, value } = eventSchema.validate(body, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const errors = error.details.map(d => d.message);
            console.warn('Validation error:', errors);
            return res.status(400).json({
                ok: false,
                error: 'Validation failed',
                details: errors
            });
        }

        // Extrair user-agent e IP do request (sobrescrever se já existir no body)
        const enrichedPayload = {
            ...value,
            userAgent: req.headers['user-agent'] || value.userAgent,
            clientIpAddress: req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || value.clientIpAddress
        };

        const q = getQueue();
        await q.add('track_event', enrichedPayload, {
            removeOnComplete: true,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000
            }
        });

        console.log('Enqueued event:', enrichedPayload.name || enrichedPayload.event_name || '(no-name)');
        return res.json({ ok: true });
    } catch (err) {
        console.error('Enqueue error:', err);
        // Não expor detalhes internos do erro para o cliente
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server listening on', PORT));


