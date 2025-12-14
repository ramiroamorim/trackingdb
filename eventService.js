const pool = require('./db');

/**
 * Salva evento no banco de dados
 * @param {Object} eventData - Dados do evento (já enriquecidos com geo pelo worker)
 * @returns {Promise<Object>} - Evento salvo
 */
async function saveEvent(eventData) {
  const query = `
    INSERT INTO events (
      event_id,
      event_name,
      event_time,
      fbp,
      fbc,
      external_id,
      value,
      currency,
      content_name,
      content_category,
      product_name,
      user_agent,
      client_ip_address,
      email,
      phone,
      city,
      state,
      zip,
      country,
      latitude,
      longitude,
      continent_code,
      continent_name,
      country_name,
      region_name,
      timezone,
      timezone_offset,
      currency_code,
      currency_symbol,
      language,
      isp,
      asn,
      connection_type,
      is_proxy,
      is_vpn,
      is_tor_exit_node,
      security_threat,
      is_mobile,
      is_tablet,
      browser,
      browser_version,
      os,
      platform,
      first_name,
      last_name,
      lead_data,
      scheduling,
      instagram
    )
    VALUES (
      $1,  $2,  $3,  $4,  $5,  $6,
      $7,  $8,  $9,  $10, $11, $12,
      $13, $14, $15, $16, $17, $18,
      $19, $20, $21, $22, $23, $24,
      $25, $26, $27, $28, $29, $30,
      $31, $32, $33, $34, $35, $36,
      $37, $38, $39, $40, $41, $42,
      $43, $44, $45, $46, $47, $48
    )
    ON CONFLICT (event_id) DO NOTHING
    RETURNING *
  `;

  const values = [
    // básicos
    eventData.event_id || eventData.eventId || null,                                       // 1
    eventData.event_name || eventData.eventName || eventData.name || 'unknown',           // 2
    eventData.event_time || eventData.eventTime || Math.floor(Date.now() / 1000),         // 3
    eventData.fbp || null,                                                                // 4
    eventData.fbc || null,                                                                // 5
    eventData.external_id || eventData.externalId || null,                                // 6

    // valor / produto
    eventData.value ?? 0,                                                                 // 7
    eventData.currency || 'BRL',                                                          // 8
    eventData.content_name || eventData.contentName || null,                              // 9
    eventData.content_category || eventData.contentCategory || null,                      // 10
    eventData.product_name || eventData.productName || null,                              // 11

    // user agent / IP
    eventData.user_agent || eventData.userAgent || null,                                  // 12
    eventData.client_ip_address || eventData.clientIpAddress || null,                     // 13

    // contato básico
    eventData.email || null,                                                              // 14
    eventData.phone || null,                                                              // 15

    // geo "bonito" (vindo do worker / apiip)
    eventData.city || null,                                                               // 16
    eventData.state || null,                                                              // 17
    eventData.zip || null,                                                                // 18
    eventData.country || null,                                                            // 19

    eventData.latitude ?? null,                                                           // 20
    eventData.longitude ?? null,                                                          // 21

    eventData.continent_code || null,                                                     // 22
    eventData.continent_name || null,                                                     // 23
    eventData.country_name || null,                                                       // 24
    eventData.region_name || null,                                                        // 25

    eventData.timezone || null,                                                           // 26
    eventData.timezone_offset || null,                                                    // 27

    eventData.currency_code || null,                                                      // 28
    eventData.currency_symbol || null,                                                    // 29

    eventData.language || null,                                                           // 30

    // rede / ISP
    eventData.isp || null,                                                                // 31
    eventData.asn ?? null,                                                                // 32
    eventData.connection_type || null,                                                    // 33

    // flags de segurança
    eventData.is_proxy ?? false,                                                          // 34
    eventData.is_vpn ?? false,                                                            // 35
    eventData.is_tor_exit_node ?? false,                                                  // 36
    eventData.security_threat || null,                                                    // 37

    // device
    eventData.is_mobile ?? false,                                                         // 38
    eventData.is_tablet ?? false,                                                         // 39
    eventData.browser || null,                                                            // 40
    eventData.browser_version || null,                                                    // 41
    eventData.os || null,                                                                 // 42
    eventData.platform || null,                                                           // 43

    // lead
    eventData.first_name || null,                                                         // 44
    eventData.last_name || null,                                                          // 45
    eventData.lead_data || null,                                                          // 46 (jsonb)
    eventData.scheduling || null,                                                         // 47 (jsonb)
    eventData.instagram || null                                                           // 48
  ];

  try {
    const result = await pool.query(query, values);
    console.log(
      'Event saved to database:',
      eventData.event_name || eventData.name,
      'IP:',
      eventData.client_ip_address || eventData.clientIpAddress,
      'city:',
      eventData.city,
      'state:',
      eventData.state,
      'country:',
      eventData.country
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving event to database:', error);
    throw error;
  }
}

module.exports = { saveEvent };
