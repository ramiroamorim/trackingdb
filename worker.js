const { saveEvent } = require('./eventService');
const { Worker } = require('bullmq');
const axios = require('axios'); // usado para apiip.net
const crypto = require('crypto');
const fetch = globalThis.fetch;

// Redis / Meta / Apiip / Test
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const META_PIXEL_ID = process.env.META_PIXEL_ID || '';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const TEST_EVENT_CODE = process.env.TEST_EVENT_CODE || '';
const APIIP_ACCESS_KEY = process.env.APIIP_ACCESS_KEY || '';

// Meta só aceita eventos até 7 dias atrás
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

// ------------------------
// Util helpers
// ------------------------
const normalizeForHash = (value, { stripNonAlphanumeric = false } = {}) => {
  if (value === undefined || value === null) return null;
  const str = value.toString().trim().toLowerCase();
  if (!str) return null;

  let normalized = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (stripNonAlphanumeric) {
    normalized = normalized.replace(/[^0-9a-z]/g, '');
  }
  return normalized;
};

const sha256 = value =>
  value ? crypto.createHash('sha256').update(value, 'utf8').digest('hex') : null;

const pickFromSources = (sources, keys) => {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const val = source[key];
      if (val !== undefined && val !== null && val !== '') {
        return val;
      }
    }
  }
  return null;
};

const extractLeadLocation = (payload = {}, enriched = {}) => {
  const sources = [
    payload.lead_data,
    payload.lead_data?.address,
    payload.lead_data?.location,
    payload,
    enriched
  ];

  return {
    city: pickFromSources(sources, ['city', 'cidade']),
    state: pickFromSources(sources, [
      'state',
      'estado',
      'region',
      'region_name',
      'regionName'
    ]),
    country: pickFromSources(sources, [
      'country',
      'pais',
      'country_code',
      'countryCode'
    ]),
    zip: pickFromSources(sources, [
      'zip',
      'zip_code',
      'postal_code',
      'postalCode',
      'cep'
    ])
  };
};

const buildHashedLocation = (payload, enriched) => {
  const { city, state, country, zip } = extractLeadLocation(payload, enriched);
  const hashed = {};

  const normalizedCity = normalizeForHash(city);
  const normalizedState = normalizeForHash(state);
  const normalizedCountry = normalizeForHash(country);
  const normalizedZip = normalizeForHash(zip, { stripNonAlphanumeric: true });

  if (normalizedCity) hashed.ct = sha256(normalizedCity);
  if (normalizedState) hashed.st = sha256(normalizedState);
  if (normalizedCountry) hashed.country = sha256(normalizedCountry);
  if (normalizedZip) hashed.zp = sha256(normalizedZip);

  return hashed;
};

// ------------------------
// Enriquecimento com Apiip
// ------------------------
async function enrichWithApiip(ip) {
  if (!ip) {
    console.log('[geo] skipping apiip: no IP');
    return {};
  }
  if (!APIIP_ACCESS_KEY) {
    console.log('[geo] skipping apiip: APIIP_ACCESS_KEY missing');
    return {};
  }

  try {
    const url = `https://apiip.net/api/check?ip=${encodeURIComponent(
      ip
    )}&accessKey=${APIIP_ACCESS_KEY}`;

    const response = await axios.get(url);
    const result = response.data || {};

    console.log(
      '[geo] apiip sample:',
      JSON.stringify(
        {
          ip: result.ip,
          city: result.city,
          regionName: result.regionName,
          countryName: result.countryName,
          postalCode: result.postalCode
        },
        null,
        2
      )
    );

    // Mapeia pros campos da tabela `events`
    return {
      city: result.city || null,
      state: result.regionName || null,
      zip: result.postalCode || null,
      country: result.countryCode || null,
      country_name: result.countryName || null,
      region_name: result.regionName || null,
      latitude: result.latitude || null,
      longitude: result.longitude || null,
      continent_code: result.continentCode || null,
      continent_name: result.continentName || null,
      timezone: result.timezone || null,
      currency_code: result.currency?.code || null,
      currency_symbol: result.currency?.symbol || null,
      isp: result.isp || null,
      asn: result.asn || null
    };
  } catch (err) {
    console.warn('[geo] exception calling apiip.net:', err.message);
    return {};
  }
}

// ------------------------
// Worker BullMQ principal
// ------------------------
const worker = new Worker(
  'analytics',
  async job => {
    console.log('Worker processing job:', job.id, job.name);
    const payload = job.data || {};

    const now = Math.floor(Date.now() / 1000);

    // event_time para banco (aceita number, se não for, força "agora")
    let dbEventTime = Number(payload.event_time);
    if (!Number.isFinite(dbEventTime)) {
      dbEventTime = now;
    }

    // event_id estável
    const eventId =
      payload.event_id ||
      payload.eventId ||
      `${payload.external_id || 'anon'}_${dbEventTime}_${
        payload.name || payload.event_name || 'event'
      }`;

    // ------------------------
    // 1) Enriquecer para o BANCO
    // ------------------------
    let enrichedForDb = {
      ...payload,
      event_id: eventId,
      event_time: dbEventTime
    };

    const clientIp =
      enrichedForDb.clientIpAddress ||
      enrichedForDb.client_ip_address ||
      null;

    // Chama Apiip só para enriquecer os campos do Postgres
    const geo = await enrichWithApiip(clientIp);
    enrichedForDb = { ...enrichedForDb, ...geo };

    // Salvar no Postgres
    try {
      await saveEvent(enrichedForDb);
      console.log(
        'Event saved to database:',
        enrichedForDb.event_name || enrichedForDb.name,
        'IP:',
        enrichedForDb.clientIpAddress || enrichedForDb.client_ip_address,
        'city:',
        enrichedForDb.city,
        'state:',
        enrichedForDb.state,
        'country:',
        enrichedForDb.country
      );
    } catch (err) {
      console.error('Error saving event to database:', err);
      throw new Error('Database save failed: ' + err.message);
    }

    // ------------------------
    // 2) Enviar para Meta CAPI
    // ------------------------
    if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
      console.log('No META config — skipping Meta API, job:', job.id);
      return { ok: true, skippedMeta: true };
    }

    // Respeitar janela de 7 dias da Meta
    if (now - dbEventTime > MAX_AGE_SECONDS) {
      console.warn('Skipping Meta send: event_time too old', {
        jobId: job.id,
        dbEventTime,
        now
      });
      return { ok: true, skippedMeta: true };
    }

    // Monta payload LIMPO para Meta (sem city/state/country puros -> usar SHA256)
    const hashedLocation = buildHashedLocation(payload, enrichedForDb);

    const hashedExternalId = sha256(
      normalizeForHash(payload.external_id || payload.externalId)
    );

    const userData = {
      ...(payload.fbp && { fbp: payload.fbp }),
      ...(payload.fbc && { fbc: payload.fbc }),
      ...(hashedExternalId && { external_id: hashedExternalId }),
      ...(clientIp && { client_ip_address: clientIp }),
      ...(payload.userAgent && { client_user_agent: payload.userAgent }),
      ...hashedLocation
    };

    const body = {
      data: [
        {
          event_name: payload.name || payload.event_name || 'custom_event',
          event_time: dbEventTime,
          action_source: 'website',
          event_id: eventId,
          user_data: userData,
          custom_data: {
            ...(payload.value && { value: payload.value }),
            ...(payload.currency && { currency: payload.currency }),
            ...(payload.content_name && { content_name: payload.content_name }),
            ...(payload.content_category && {
              content_category: payload.content_category
            }),
            ...(payload.props || {})
          }
        }
      ]
    };

    const resp = await fetch(
      `https://graph.facebook.com/v24.0/${META_PIXEL_ID}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          access_token: META_ACCESS_TOKEN,
          ...(TEST_EVENT_CODE && { test_event_code: TEST_EVENT_CODE })
        })
      }
    );

    const txt = await resp.text();

    if (!resp.ok) {
      console.error('Meta API error raw:', txt);
      throw new Error('Meta API error: ' + resp.status + ' ' + txt);
    }

    console.log('Meta API success:', txt);
    console.log('Sent event to Meta, job:', job.id);

    return { ok: true };
  },
  { connection: { url: REDIS_URL }, concurrency: 5 }
);

worker.on('completed', job =>
  console.log('Job completed', job.id)
);
worker.on('failed', (job, err) =>
  console.error('Job failed', job?.id, err?.message || err)
);

module.exports = worker;
