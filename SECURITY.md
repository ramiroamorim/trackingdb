# 🔒 Guia de Segurança - Backend Event Tracking

## ⚠️ AÇÕES URGENTES NECESSÁRIAS

### 1. Trocar Credenciais Expostas (IMEDIATO!)

As seguintes credenciais foram expostas no repositório Git e **precisam ser trocadas imediatamente**:

#### Facebook Access Token
1. Acesse: https://business.facebook.com/events_manager
2. Navegue até seu Pixel ID: `729707362823138`
3. Vá em **Settings** > **Conversions API** > **Generate Access Token**
4. **Revogue** o token antigo
5. Gere um novo token e atualize `META_ACCESS_TOKEN` no `.env.production`

#### Senha do Banco de Dados
1. Conecte no PostgreSQL em `172.31.18.222`
2. Execute:
   ```sql
   ALTER USER ramiro WITH PASSWORD 'nova-senha-forte-aqui';
   ```
3. Atualize `DB_PASSWORD` no `.env.production`

#### Gerar API Key (NOVO)
```bash
# Gerar uma chave segura
openssl rand -hex 32
```
Adicione ao `.env.production`:
```
API_KEY=chave-gerada-aqui
```

### 2. Remover Secrets do Histórico do Git

**⚠️ CRÍTICO:** O arquivo `.env.production` foi commitado. Para removê-lo do histórico:

```bash
# Opção 1: Usando git filter-repo (recomendado)
git filter-repo --path .env.production --invert-paths

# Opção 2: Usando BFG Repo-Cleaner
bfg --delete-files .env.production

# Após remover, force push (CUIDADO!)
git push origin --force --all
git push origin --force --tags
```

**Nota:** Qualquer pessoa que tenha clonado o repositório ainda terá acesso aos secrets antigos. Por isso é crítico trocar as credenciais PRIMEIRO.

---

## 🛡️ Configuração de Segurança

### Variáveis de Ambiente Obrigatórias

Para produção, estas variáveis **DEVEM** estar configuradas:

```bash
# Autenticação
API_KEY=sua-chave-aqui  # OBRIGATÓRIO! Gere com: openssl rand -hex 32

# Facebook
META_PIXEL_ID=seu-pixel-id
META_ACCESS_TOKEN=seu-token

# Database
DB_HOST=seu-host
DB_PASSWORD=senha-forte
```

### Como Usar a API Key

Todos os requests para `/api/event` devem incluir o header:

```bash
curl -X POST https://sua-api.com/api/event \
  -H "Content-Type: application/json" \
  -H "x-api-key: sua-api-key-aqui" \
  -d '{"name": "purchase", "value": 100}'
```

---

## 📊 Rate Limiting

- **Limite:** 100 requests por minuto por IP
- **Resposta ao ultrapassar:**
  ```json
  {
    "ok": false,
    "error": "Too many requests, please try again later"
  }
  ```

---

## ✅ Validação de Eventos

### Campos Aceitos

```javascript
{
  // Nome do evento (um dos dois é obrigatório)
  "name": "string (max 100)",
  "event_name": "string (max 100)",

  // Identificadores
  "event_id": "string (max 200)",
  "external_id": "string (max 200)",

  // Facebook pixels
  "fbp": "string (max 500)",
  "fbc": "string (max 500)",

  // Dados do evento
  "event_time": "integer (unix timestamp)",
  "value": "number (positive)",
  "currency": "string (3 chars, ex: BRL)",

  // Conteúdo
  "content_name": "string (max 200)",
  "content_category": "string (max 200)",
  "product_name": "string (max 200)",

  // Dados customizados
  "userData": "object",
  "props": "object",

  // Automáticos (extraídos do request)
  "userAgent": "string (max 500)",  // Extraído automaticamente
  "clientIpAddress": "string (IP)"  // Extraído automaticamente
}
```

### Exemplo de Request Válido

```json
{
  "name": "Purchase",
  "event_id": "order_123456",
  "external_id": "user_789",
  "fbp": "fb.1.1234567890.1234567890",
  "value": 199.90,
  "currency": "BRL",
  "content_name": "Produto Premium",
  "userData": {
    "email": "cliente@example.com",
    "phone": "+5511999999999"
  },
  "props": {
    "product_id": "prod_123",
    "category": "electronics"
  }
}
```

---

## 🚫 Proteções Implementadas

### 1. Input Validation
- Schema validation com Joi
- Rejeita campos desconhecidos
- Valida tipos e formatos

### 2. Rate Limiting
- 100 requests/minuto por IP
- Previne ataques de DoS

### 3. Request Size Limit
- Máximo 1MB por request
- Previne memory exhaustion

### 4. API Key Authentication
- Header obrigatório: `x-api-key`
- Previne acesso não autorizado

### 5. CORS Restritivo
- Apenas origins permitidas
- Configurável via `FRONTEND_URL`

### 6. Error Handling
- Não expõe detalhes internos
- Logs estruturados

### 7. Facebook API Security
- Token via Authorization header (não URL)
- Event deduplication com `event_id`
- Retry com backoff exponencial

---

## 📝 Checklist de Deploy

Antes de fazer deploy em produção:

- [ ] Trocar todas as credenciais expostas
- [ ] Configurar `API_KEY` no ambiente
- [ ] Remover `.env.production` do Git
- [ ] Configurar `FRONTEND_URL` correto
- [ ] Testar rate limiting
- [ ] Testar autenticação
- [ ] Verificar logs do New Relic
- [ ] Testar envio para Facebook API
- [ ] Verificar salvamento no banco de dados
- [ ] Configurar backup do PostgreSQL
- [ ] Configurar SSL/TLS no load balancer
- [ ] Habilitar CloudWatch/DataDog para alertas

---

## 🐛 Bugs Corrigidos

### Bug Crítico #1: Eventos não sendo salvos no banco
**Status:** ✅ CORRIGIDO

O código de salvamento estava fora do handler do worker. Agora está dentro e executa para cada job.

### Bug #2: Token do Facebook na URL
**Status:** ✅ CORRIGIDO

Token agora é enviado via `Authorization: Bearer` header.

### Bug #3: Eventos duplicados no Facebook
**Status:** ✅ CORRIGIDO

Agora inclui `event_id` para deduplicação.

### Bug #4: Timestamps incorretos
**Status:** ✅ CORRIGIDO

Usa `event_time` do payload quando disponível.

### Bug #5: Sem validação de input
**Status:** ✅ CORRIGIDO

Schema validation com Joi implementado.

---

## 📞 Suporte

Para questões de segurança, entre em contato com o time de DevSecOps.
