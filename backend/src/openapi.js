'use strict';

/** @type {import('swagger-ui-express').JsonObject} */
const spec = {
  openapi: '3.0.3',
  info: {
    title: 'SMS Gateway API',
    version: '1.0.0',
    description: `
## Authentication

Most endpoints require a **JWT Bearer token**.

**How to obtain a token:**

\`\`\`
POST /api/auth/login
{ "username": "sysadmin", "password": "Password!" }
\`\`\`

Copy the \`token\` from the response, then click **"Authorize"** (🔓) at the top of this page and paste it.

The token is valid for the duration set in \`JWT_EXPIRES_IN\` (default **8 hours**).

---

### Role hierarchy

| Role | Level |
|---|---|
| \`superadmin\` | Full access, including SAML and audit log |
| \`admin\` | Manage users, devices, rules, groups |
| \`user\` | Access according to assigned permissions |
    `,
  },
  servers: [{ url: '/api', description: 'Current server' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste the token returned by POST /api/auth/login',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Unauthorized' },
        },
      },
      Ok: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
        },
      },
      User: {
        type: 'object',
        properties: {
          id:            { type: 'string', format: 'uuid' },
          username:      { type: 'string', example: 'john' },
          display_name:  { type: 'string', nullable: true, example: 'John Doe', description: 'Full name taken from LDAP (null for local users)' },
          role:          { type: 'string', enum: ['superadmin', 'admin', 'user'] },
          source:        { type: 'string', enum: ['local', 'ldap', 'saml'], description: '\'ldap\' and \'saml\' users are created automatically on first login' },
          permissions:   { type: 'object', example: { inbox: true, sent: true, rules: false } },
          allowed_ports: { type: 'array', items: { type: 'object', properties: { device_id: { type: 'string' }, port_number: { type: 'integer' } } }, description: 'Empty array = all ports allowed' },
          created_at:    { type: 'string', format: 'date-time' },
          last_login:    { type: 'string', format: 'date-time', nullable: true, description: 'UTC timestamp of last successful login. Null if the user has never logged in.' },
          is_online:     { type: 'boolean', description: 'True if the user has made an authenticated request in the last 5 minutes (in-memory, resets on server restart).' },
        },
      },
      Message: {
        type: 'object',
        properties: {
          id:             { type: 'string', format: 'uuid' },
          direction:      { type: 'string', enum: ['inbound', 'outbound'] },
          sender:         { type: 'string', example: '+39012345678' },
          recipient:      { type: 'string', example: '+39087654321' },
          sender_name:    { type: 'string', nullable: true, example: 'John Smith', description: 'Display name from phonebook (inbound messages)' },
          recipient_name: { type: 'string', nullable: true, example: 'Jane Doe', description: 'Display name from phonebook (outbound messages)' },
          content:        { type: 'string', example: 'Hello world' },
          status:         { type: 'string', enum: ['received', 'pending', 'sent', 'failed'] },
          device_id:      { type: 'string', format: 'uuid' },
          port:           { type: 'integer', example: 1 },
          created_at:     { type: 'string', format: 'date-time' },
        },
      },
      Device: {
        type: 'object',
        properties: {
          id:        { type: 'string', format: 'uuid' },
          name:      { type: 'string', example: 'Yeastar S100' },
          host:      { type: 'string', example: '192.168.1.100' },
          port:      { type: 'integer', example: 5038 },
          username:  { type: 'string', example: 'apiuser' },
          enabled:   { type: 'boolean' },
          connected: { type: 'boolean' },
        },
      },
      Rule: {
        type: 'object',
        properties: {
          id:                 { type: 'string', format: 'uuid' },
          name:               { type: 'string', example: 'Forward IT alerts' },
          enabled:            { type: 'boolean' },
          priority:           { type: 'integer', example: 10 },
          condition_operator: { type: 'string', enum: ['AND', 'OR'] },
          stop_on_match:      { type: 'boolean' },
          conditions:         { type: 'array', items: { type: 'object' } },
          targets:            { type: 'array', items: { type: 'object' } },
          sms_targets:        { type: 'array', items: { type: 'string' }, description: 'Phone numbers (E.164) for SMS forwarding' },
          allowed_groups:       { type: 'array', items: { type: 'string' }, description: 'LDAP group DNs allowed to see matched messages' },
          allowed_local_groups: { type: 'array', items: { type: 'string', format: 'uuid' }, description: 'Local group IDs allowed to see matched messages' },
          webhook_url:        { type: 'string', format: 'uri', nullable: true, example: 'http://myserver.internal/webhook' },
          webhook_method:     { type: 'string', enum: ['POST', 'GET', 'PUT'], default: 'POST' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],

  paths: {

    // ─── AUTH ───────────────────────────────────────────────────────────────

    '/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Login — obtain a JWT token',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string', example: 'sysadmin' },
                  password: { type: 'string', example: 'Password!' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Login successful',
            content: {
              'application/json': {
                example: {
                  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                  user: { id: 'uuid', username: 'sysadmin', role: 'superadmin', permissions: {} },
                },
              },
            },
          },
          401: { description: 'Invalid credentials', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
        },
      },
    },

    '/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Get current authenticated user',
        responses: {
          200: {
            description: 'Current user info',
            content: {
              'application/json': {
                example: { id: 'uuid', username: 'sysadmin', role: 'superadmin', permissions: {} },
              },
            },
          },
          401: { description: 'Unauthorized', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
        },
      },
    },

    '/auth/saml/status': {
      get: {
        tags: ['Authentication'],
        summary: 'Check if SAML SSO is configured and enabled',
        security: [],
        responses: {
          200: {
            description: '',
            content: { 'application/json': { example: { enabled: true } } },
          },
        },
      },
    },

    '/auth/saml/metadata': {
      get: {
        tags: ['Authentication'],
        summary: 'SP metadata XML (give this URL to your IdP)',
        security: [],
        responses: {
          200: { description: 'SAML SP metadata XML', content: { 'application/xml': {} } },
        },
      },
    },

    '/auth/saml/login': {
      get: {
        tags: ['Authentication'],
        summary: 'Initiate SP-initiated SAML login (redirects to IdP)',
        security: [],
        responses: {
          302: { description: 'Redirect to Identity Provider' },
        },
      },
    },

    // ─── HEALTH ─────────────────────────────────────────────────────────────

    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check — uptime and device status',
        security: [],
        responses: {
          200: {
            description: '',
            content: {
              'application/json': {
                example: {
                  status: 'ok',
                  uptime: 3600,
                  devices: [{ id: 'uuid', name: 'Yeastar S100', connected: true }],
                },
              },
            },
          },
        },
      },
    },

    // ─── MESSAGES ───────────────────────────────────────────────────────────

    '/messages': {
      get: {
        tags: ['Messages'],
        summary: 'List messages (paginated)',
        parameters: [
          { name: 'direction', in: 'query', schema: { type: 'string', enum: ['inbound', 'outbound'] } },
          { name: 'device_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'page',      in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit',     in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'search',    in: 'query', schema: { type: 'string' }, description: 'Full-text search in sender/recipient/content' },
        ],
        responses: {
          200: {
            description: 'Paginated result',
            content: {
              'application/json': {
                example: {
                  data: [{ id: 'uuid', direction: 'inbound', sender: '+39012345678', content: 'Hello', status: 'received', created_at: '2026-03-01T10:00:00Z' }],
                  total: 1, page: 1, limit: 50, pages: 1,
                },
              },
            },
          },
        },
      },
    },

    '/messages/stats': {
      get: {
        tags: ['Messages'],
        summary: 'Message statistics (counts)',
        responses: {
          200: {
            description: '',
            content: {
              'application/json': {
                example: { received_today: 12, sent_today: 5, total_inbound: 340, failed: 2 },
              },
            },
          },
        },
      },
    },

    '/messages/send': {
      post: {
        tags: ['Messages'],
        summary: 'Send an SMS',
        description:
          'Send an outbound SMS via a specific SIM port or via the **balanced auto-routing pool**.\n\n' +
          '**Manual send** (`port` = integer) — Specify `device_id` (UUID of the Yeastar device) and `port` (1–16). The monthly limit of the selected port is enforced server-side: if reached, returns **HTTP 429**.\n\n' +
          '**Balanced auto-routing** (`port` = `"auto"`) — Omit `device_id`. The system picks the best available SIM automatically:\n\n' +
          '| Step | Rule |\n' +
          '|------|------|\n' +
          '| Eligible pool | Ports with `balanced = true` on connected, enabled devices |\n' +
          '| Limit filter | Ports at or above their `monthly_limit` are excluded |\n' +
          '| Selection | Port with the **lowest usage ratio** (`sent / limit`); unlimited ports sorted by raw `sent_count` |\n' +
          '| Tie-break | Stable order by `device_id`, `port_number` |\n' +
          '| Permissions | Non-admin users: only ports in their `allowed_ports` list are candidates |\n' +
          '| No match | Returns **HTTP 503** |\n\n' +
          '> **Single-SIM pool:** if only one SIM is in the balanced pool it handles all `"auto"` requests alone.' +
          ' If it reaches its monthly limit, subsequent requests return **HTTP 503** until the next month.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['port', 'recipient', 'message'],
                properties: {
                  device_id: { type: 'string', format: 'uuid', description: 'UUID of the Yeastar device. Required when `port` is an integer; omit when `port="auto"`.' },
                  port: {
                    description: 'SIM port number (1–16) for manual send, or `"auto"` to trigger balanced auto-routing (see operation description).',
                    oneOf: [
                      { type: 'integer', minimum: 1, maximum: 16, example: 1 },
                      { type: 'string', enum: ['auto'] },
                    ],
                  },
                  recipient: { type: 'string', example: '+39012345678', description: 'Recipient phone number. Digits only with optional `+` prefix (spaces, dashes, and parentheses are stripped automatically). Use `GET /api/phonebook` to retrieve contacts from the phonebook.' },
                  message:   { type: 'string', minLength: 1, maxLength: 1024, example: 'Hello from API!' },
                },
              },
              examples: {
                auto: {
                  summary: '✅ Balanced auto-routing (port="auto") — recommended',
                  value: { port: 'auto', recipient: '+39012345678', message: 'Hello!' },
                },
                manual: {
                  summary: 'Manual port selection (port=integer, device_id required)',
                  value: { device_id: '00000000-0000-0000-0000-000000000001', port: 3, recipient: '+39012345678', message: 'Hello!' },
                },
              },
            },
          },
        },
        responses: {
          202: {
            description: 'Message queued for delivery',
            content: { 'application/json': { example: { id: 'uuid', gsmId: '123', status: 'pending' } } },
          },
          400: { description: 'Validation error or missing device_id' },
          429: { description: 'Monthly send limit reached for the selected SIM port (manual send only)' },
          503: { description: 'No balanced SIM available (port="auto") or device not connected' },
        },
      },
    },

    // ─── DEVICES ────────────────────────────────────────────────────────────

    '/devices': {
      get: {
        tags: ['Devices'],
        summary: 'List all devices with connection status',
        responses: {
          200: {
            description: '',
            content: {
              'application/json': {
                example: [{ id: 'uuid', name: 'Yeastar S100', host: '192.168.1.100', port: 5038, connected: true, enabled: true }],
              },
            },
          },
        },
      },
      post: {
        tags: ['Devices'],
        summary: 'Add a new device',
        description: '**Audit-logged** (`device:create`).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'host', 'password'],
                properties: {
                  name:     { type: 'string', example: 'Yeastar S100' },
                  host:     { type: 'string', example: '192.168.1.100' },
                  port:     { type: 'integer', default: 5038 },
                  username: { type: 'string', default: 'apiuser' },
                  password: { type: 'string', example: 'secret' },
                  enabled:  { type: 'boolean', default: true },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Device created', content: { 'application/json': { example: { id: 'uuid' } } } },
        },
      },
    },

    '/devices/{id}': {
      get: {
        tags: ['Devices'],
        summary: 'Get a device by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Device' } } } },
          404: { description: 'Not found' },
        },
      },
      put: {
        tags: ['Devices'],
        summary: 'Update a device',
        description: '**Audit-logged** (`device:update`).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name:     { type: 'string' },
                  host:     { type: 'string' },
                  port:     { type: 'integer' },
                  username: { type: 'string' },
                  password: { type: 'string' },
                  enabled:  { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } },
        },
      },
      delete: {
        tags: ['Devices'],
        summary: 'Delete a device',
        description: '**Audit-logged** (`device:delete`).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } },
        },
      },
    },

    // ─── PORTS ──────────────────────────────────────────────────────────────

    '/ports': {
      get: {
        tags: ['Ports'],
        summary: 'List SIM ports (optionally filter by device)',
        description: 'Returns all SIM ports with their current-month `sent_count`. For non-admin users, only ports present in their `allowed_ports` permission list are returned (enforced at the backend).',
        parameters: [
          { name: 'device_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by device UUID. When provided, also triggers a live port-status refresh from the device.' },
        ],
        responses: {
          200: {
            description: 'Array of SIM port objects',
            content: {
              'application/json': {
                example: [{ device_id: 'uuid', port_number: 1, balanced: 0, monthly_limit: 200, sim_number: '+39012345678', operator: 'Wind', status: 'READY', device_name: 'GSM-01', sent_count: 42 }],
              },
            },
          },
        },
      },
    },

    '/ports/stats': {
      get: {
        tags: ['Ports'],
        summary: 'Monthly SMS usage per SIM port — admin/superadmin only',
        parameters: [
          { name: 'month', in: 'query', schema: { type: 'string', example: '2025-06' }, description: 'Month in YYYY-MM format (defaults to current month)' },
        ],
        responses: {
          200: {
            description: '',
            content: {
              'application/json': {
                example: {
                  month: '2025-06',
                  ports: [{ device_id: 'uuid', port_number: 1, balanced: 1, monthly_limit: 200, sim_number: '+39012345678', operator: 'TIM', device_name: 'GSM-01', sent_count: 42 }],
                },
              },
            },
          },
          403: { description: 'Admin access required' },
        },
      },
    },

    '/ports/{device_id}/{port_number}/info': {
      put: {
        tags: ['Ports'],
        summary: 'Update SIM port metadata (sim_number, operator, balanced, monthly_limit)',
        description: 'Only the fields present in the request body are updated. All fields are optional — send only what you want to change. If the port row does not exist yet it is created with balanced=0 as default. **Audit-logged** (`port:update`).',
        parameters: [
          { name: 'device_id',   in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'port_number', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  sim_number:    { type: 'string',  example: '+39012345678', description: 'Phone number of the SIM. Pass empty string to clear.' },
                  operator:      { type: 'string',  example: 'Wind', description: 'Carrier / operator label. Pass empty string to clear.' },
                  balanced:      { type: 'boolean', description: 'Include this port in the balanced SIM pool (least-used-ratio routing).' },
                  monthly_limit: { type: 'integer', minimum: 0, description: 'Max outbound SMS per month for this SIM. 0 = no limit. Ports at or above limit are excluded from auto-routing.' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } },
        },
      },
    },

    // ─── RULES ──────────────────────────────────────────────────────────────

    '/rules': {
      get: {
        tags: ['Rules'],
        summary: 'List all forwarding rules',
        responses: {
          200: { description: '', content: { 'application/json': { schema: { type: 'array', items: { '$ref': '#/components/schemas/Rule' } } } } },
        },
      },
      post: {
        tags: ['Rules'],
        summary: 'Create a forwarding rule',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'conditions'],
                properties: {
                  name:               { type: 'string', example: 'Forward IT alerts' },
                  enabled:            { type: 'boolean', default: true },
                  priority:           { type: 'integer', default: 0 },
                  condition_operator: { type: 'string', enum: ['AND', 'OR'], default: 'AND' },
                  stop_on_match:      { type: 'boolean', default: false },
                  conditions: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      properties: {
                        type:  { type: 'string', enum: ['any', 'sender', 'sender_regex', 'content', 'content_regex', 'device'] },
                        value: { type: 'string', example: '+39012345678' },
                      },
                    },
                    example: [{ type: 'sender', value: '+39012345678' }],
                  },
                  targets: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type:  { type: 'string', enum: ['email', 'webhook'] },
                        value: { type: 'string', example: 'admin@example.com' },
                      },
                    },
                  },
                  sms_targets: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Phone numbers in E.164 format for SMS forwarding',
                    example: ['+39012345678'],
                  },
                  allowed_groups:       { type: 'array', items: { type: 'string' }, description: 'LDAP group DNs that can see this rule' },
                  allowed_local_groups: { type: 'array', items: { type: 'string', format: 'uuid' }, description: 'Local group IDs that can see this rule' },
                  webhook_url:    { type: 'string', format: 'uri', nullable: true, example: 'http://myserver.internal/hook', description: 'Optional HTTP webhook URL (host must be in the whitelist)' },
                  webhook_method: { type: 'string', enum: ['POST', 'GET', 'PUT'], default: 'POST' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Rule created', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Rule' } } } },
        },
      },
    },

    '/rules/test': {
      post: {
        tags: ['Rules'],
        summary: 'Simulate rule matching against a fake SMS (dry-run)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sender', 'content'],
                properties: {
                  sender:    { type: 'string', example: '+39012345678' },
                  content:   { type: 'string', example: 'Alert: CPU 95%' },
                  device_id: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'List of matched rules',
            content: {
              'application/json': {
                example: { matched: [{ id: 'uuid', name: 'Forward IT alerts', priority: 10 }] },
              },
            },
          },
        },
      },
    },

    '/rules/{id}': {
      get: {
        tags: ['Rules'],
        summary: 'Get a rule by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Rule' } } } },
          404: { description: 'Not found' },
        },
      },
      put: {
        tags: ['Rules'],
        summary: 'Update a rule',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name:               { type: 'string' },
                  enabled:            { type: 'boolean' },
                  priority:           { type: 'integer' },
                  condition_operator: { type: 'string', enum: ['AND', 'OR'] },
                  stop_on_match:      { type: 'boolean' },
                  conditions:         { type: 'array', items: { type: 'object' } },
                  targets:            { type: 'array', items: { type: 'object' } },
                  sms_targets:        { type: 'array', items: { type: 'string' } },
                  allowed_groups:       { type: 'array', items: { type: 'string' } },
                  allowed_local_groups: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  webhook_url:    { type: 'string', format: 'uri', nullable: true },
                  webhook_method: { type: 'string', enum: ['POST', 'GET', 'PUT'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Rule' } } } },
        },
      },
      delete: {
        tags: ['Rules'],
        summary: 'Delete a rule',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } },
        },
      },
    },

    // ─── SETTINGS ───────────────────────────────────────────────────────────

    '/settings/webhook': {
      get: {
        tags: ['Settings'],
        summary: 'Get webhook allowed hosts whitelist',
        responses: {
          200: {
            description: '',
            content: {
              'application/json': {
                example: { allowed_hosts: 'myserver.internal\n*.company.com\n192.168.1.0/24' },
              },
            },
          },
        },
      },
      post: {
        tags: ['Settings'],
        summary: 'Save webhook allowed hosts whitelist',
        description: 'Newline- or comma-separated list of allowed hostnames, wildcards (`*.domain`), or CIDR ranges (`192.168.1.0/24`). An empty string blocks all webhooks. **Audit-logged** (`settings:webhook_update`).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['allowed_hosts'],
                properties: {
                  allowed_hosts: { type: 'string', example: 'myserver.internal\n*.company.com\n192.168.1.0/24' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } },
        },
      },
    },

    '/settings/smtp': {
      get: {
        tags: ['Settings'],
        summary: 'Get SMTP configuration (password hidden)',
        responses: {
          200: {
            description: '',
            content: {
              'application/json': {
                example: { host: 'smtp.example.com', port: 587, secure: false, ignoreTls: false, user: 'noreply@example.com', from: 'SMS Gateway <noreply@example.com>' },
              },
            },
          },
        },
      },
      post: {
        tags: ['Settings'],
        summary: 'Save SMTP configuration',
        description: '**Audit-logged** (`settings:smtp_update`). The password is stored encrypted.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['host', 'port', 'user', 'pass', 'from'],
                properties: {
                  host:      { type: 'string', example: 'smtp.example.com' },
                  port:      { type: 'integer', example: 587 },
                  secure:    { type: 'boolean', default: false },
                  ignoreTls: { type: 'boolean', default: false },
                  user:      { type: 'string', format: 'email', example: 'noreply@example.com' },
                  pass:      { type: 'string', example: 'secret' },
                  from:      { type: 'string', example: 'SMS Gateway <noreply@example.com>' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } },
        },
      },
    },

    '/settings/smtp/test': {
      post: {
        tags: ['Settings'],
        summary: 'Send a test email',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['to'],
                properties: { to: { type: 'string', format: 'email', example: 'admin@example.com' } },
              },
            },
          },
        },
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } },
        },
      },
    },

    '/settings/email-template': {
      get: {
        tags: ['Settings'],
        summary: 'Get the email body template',
        responses: {
          200: { description: '', content: { 'application/json': { example: { template: 'New SMS from {{sender}}:\n\n{{content}}' } } } },
        },
      },
      post: {
        tags: ['Settings'],
        summary: 'Save the email body template',
        description: '**Audit-logged** (`settings:email_template_update`).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['template'],
                properties: { template: { type: 'string', maxLength: 51200 } },
              },
            },
          },
        },
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } },
        },
      },
    },

    '/settings/email-subject': {
      get: {
        tags: ['Settings'],
        summary: 'Get the email subject template',
        responses: {
          200: { description: '', content: { 'application/json': { example: { subject: 'New SMS from {{sender}}' } } } },
        },
      },
      post: {
        tags: ['Settings'],
        summary: 'Save the email subject template',
        description: '**Audit-logged** (`settings:email_subject_update`).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['subject'],
                properties: { subject: { type: 'string', maxLength: 200 } },
              },
            },
          },
        },
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } },
        },
      },
    },

    '/settings/saml': {
      get: {
        tags: ['Settings (Superadmin)'],
        summary: 'Get SAML configuration — superadmin only',
        responses: {
          200: {
            description: '',
            content: {
              'application/json': {
                example: {
                  enabled: true, sp_base_url: 'https://sms.example.com',
                  sp_entity_id: 'https://sms.example.com/api/auth/saml/metadata',
                  idp_sso_url: 'https://idp.example.com/saml/sso',
                  idp_cert: '-----BEGIN CERTIFICATE-----\n...',
                  username_attribute: 'uid', display_name_attribute: 'cn', default_role: 'user',
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Settings (Superadmin)'],
        summary: 'Save SAML configuration — superadmin only',
        description: '**Audit-logged** (`settings:saml_update`).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['enabled', 'sp_base_url', 'idp_sso_url', 'idp_cert'],
                properties: {
                  enabled:                   { type: 'boolean' },
                  sp_base_url:               { type: 'string', example: 'https://sms.example.com' },
                  sp_entity_id:              { type: 'string' },
                  idp_sso_url:               { type: 'string' },
                  idp_cert:                  { type: 'string' },
                  username_attribute:        { type: 'string', default: 'uid' },
                  display_name_attribute:    { type: 'string', default: 'cn' },
                  default_role:              { type: 'string', enum: ['admin', 'user'], default: 'user' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } },
        },
      },
    },

    // ─── NTP / TIMEZONE ─────────────────────────────────────────────────────

    '/settings/ntp': {
      get: {
        tags: ['Settings (Admin)'],
        summary: 'Get NTP server and timezone configuration — admin+',
        description: 'Returns the NTP server hostname and the IANA timezone currently stored in the DB. The timezone is applied to all timestamps in the application. Priority: DB value > `.env TZ` > system default.',
        responses: {
          200: {
            description: '',
            content: {
              'application/json': {
                example: { ntp_server: 'pool.ntp.org', timezone: 'Europe/Rome' },
              },
            },
          },
        },
      },
      post: {
        tags: ['Settings (Admin)'],
        summary: 'Save NTP server and timezone — admin+',
        description: 'Persists both values in the DB and applies the timezone immediately to the running Node.js process (no restart needed). Survives container restarts. The IANA timezone string is validated server-side via `Intl`. **Audit-logged** (`settings:ntp_update`).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ntp_server', 'timezone'],
                properties: {
                  ntp_server: { type: 'string', example: 'pool.ntp.org', description: 'Hostname or IP of the NTP server' },
                  timezone:   { type: 'string', example: 'Europe/Rome', description: 'IANA timezone identifier (must be valid in Node.js Intl)' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } },
          400: { description: 'Invalid hostname or unrecognised IANA timezone' },
        },
      },
    },

    '/settings/ntp/sync': {
      post: {
        tags: ['Settings (Admin)'],
        summary: 'Query the configured NTP server — admin+',
        description: 'Sends a UDP NTP request (RFC 4330) to the configured NTP server using the built-in Node.js `dgram` module (no extra packages). Returns the server time, system time, and the clock offset in milliseconds. Does **not** modify the system clock.',
        responses: {
          200: {
            description: 'NTP query succeeded',
            content: {
              'application/json': {
                example: {
                  ok: true,
                  ntp_server:  'pool.ntp.org',
                  ntp_time:    '2026-03-29T10:00:00.123Z',
                  system_time: '2026-03-29T10:00:00.145Z',
                  offset_ms:   -22,
                },
              },
            },
          },
          500: { description: 'UDP send error or response parse failure' },
          504: { description: 'NTP query timed out (8 s)' },
        },
      },
    },

    // ─── REPORT ─────────────────────────────────────────────────────────────

    '/report': {
      get: {
        tags: ['Report'],
        summary: 'Traffic report (last N days)',
        parameters: [
          { name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
        ],
        responses: {
          200: {
            description: '',
            content: {
              'application/json': {
                example: {
                  days: 30,
                  totals: { total_inbound: 340, total_outbound: 12, total: 352, sent: 11, failed: 1 },
                  smsByDay: [{ day: '2026-03-01', inbound: 15, outbound: 2 }],
                  smsByDevice: [{ device: 'Yeastar S100', total: 352, inbound: 340, outbound: 12 }],
                  dispatchByRule: [{ rule: 'Forward IT', dispatches: 5, sent: 4, failed: 1 }],
                  dispatchLog: [{ id: 'uuid', rule_name: 'Forward IT', sender: '+39012345678', content: 'Alert', status: 'sent', sent_at: '2026-03-01T10:05:00Z' }],
                },
              },
            },
          },
        },
      },
    },

    // ─── USERS ──────────────────────────────────────────────────────────────

    '/users': {
      get: {
        tags: ['Users (Admin)'],
        summary: 'List all users — admin only',
        description:
          'Returns all users (local, LDAP and SAML). Each object now includes:\n\n' +
          '- **`last_login`** — UTC datetime of the last successful login (`null` if never logged in). Persisted in SQLite.\n' +
          '- **`is_online`** — `true` when the user has sent at least one authenticated API request within the last **5 minutes**. Maintained in-memory; resets to `false` after a server restart.\n' +
          '- **`display_name`** — full name from LDAP/SAML (`null` for local users).\n' +
          '- **`source`** — `local`, `ldap`, or `saml`.\n' +
          '- **`permissions`** — object with a key per feature (`dashboard`, `inbox`, `sent`, `send`, `report`, `devices`, `ports`, `rules`, `settings`, `users`, `api`, `phonebook`), value `true`/`false`. For LDAP users, permissions are re-resolved from the current group mappings on every login; the `permissions` field returned here reflects the values stored at the time of the last login.\n\n' +
          'Admin and Super Admin users always have full access regardless of the `permissions` object content.\n\n' +
          'The UI user list supports search (by username or display name), paginates at **25 rows per page**, and opens a read-only detail panel (double-click) showing the full permission grid with granted/denied status for every feature.',
        responses: {
          200: { description: '', content: { 'application/json': { schema: { type: 'array', items: { '$ref': '#/components/schemas/User' } } } } },
        },
      },
      post: {
        tags: ['Users (Admin)'],
        summary: 'Create a user — admin only',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password', 'role'],
                properties: {
                  username:    { type: 'string', minLength: 3, maxLength: 50, example: 'john' },
                  password:    { type: 'string', minLength: 8, pattern: '^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$', description: 'Min 8 chars, must include uppercase, number and special character', example: 'P@ss1234' },
                  role:        { type: 'string', enum: ['admin', 'user'] },
                  permissions: { type: 'object', example: { inbox: true, sent: true } },
                  allowed_ports: { type: 'array', items: { type: 'object', properties: { device_id: { type: 'integer' }, port_number: { type: 'integer' } } }, description: 'Restrict user to specific device/port combinations. Empty = all ports allowed.' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: '', content: { 'application/json': { example: { id: 'uuid' } } } },
        },
      },
    },

    '/users/{id}': {
      put: {
        tags: ['Users (Admin)'],
        summary: 'Update a user — admin only',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  password:  { type: 'string', minLength: 8, pattern: '^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$', description: 'Min 8 chars, must include uppercase, number and special character' },
                  role:      { type: 'string', enum: ['admin', 'user'] },
                  permissions: { type: 'object' },
                  allowed_ports: { type: 'array', items: { type: 'object', properties: { device_id: { type: 'integer' }, port_number: { type: 'integer' } } }, description: 'Restrict user to specific device/port combinations. Empty = all ports allowed.' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } },
        },
      },
      delete: {
        tags: ['Users (Admin)'],
        summary: 'Delete a user — admin only',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } },
        },
      },
    },

    '/users/permissions': {
      get: {
        tags: ['Users (Admin)'],
        summary: 'List available permission keys',
        responses: {
          200: { description: '', content: { 'application/json': { example: ['dashboard', 'inbox', 'sent', 'send_sms', 'rules', 'devices', 'report', 'users'] } } },
        },
      },
    },

    '/users/ldap-settings': {
      get: {
        tags: ['Users (Admin)'],
        summary: 'Get LDAP configuration',
        responses: {
          200: {
            description: '',
            content: {
              'application/json': {
                example: {
                  enabled: true, host: 'ldap://dc.example.com',
                  bind_dn: 'cn=svc,dc=example,dc=com', bind_password: '__SAVED__',
                  base_dn: 'dc=example,dc=com', search_filter: '(sAMAccountName={{username}})',
                  group_mappings: [{ group_dn: 'CN=ITAdmins,OU=Groups,DC=example,DC=com', role: 'admin' }],
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Users (Admin)'],
        summary: 'Save LDAP configuration',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  enabled:         { type: 'boolean' },
                  host:            { type: 'string', example: 'ldap://dc.example.com' },
                  bind_dn:         { type: 'string' },
                  bind_password:   { type: 'string', description: 'Use __SAVED__ to keep existing value' },
                  base_dn:         { type: 'string' },
                  search_filter:   { type: 'string', example: '(sAMAccountName={{username}})' },
                  group_mappings:  { type: 'array', items: { type: 'object', properties: { group_dn: { type: 'string' }, role: { type: 'string' } } } },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } },
        },
      },
    },

    '/users/ldap-test': {
      post: {
        tags: ['Users (Admin)'],
        summary: 'Test LDAP connection',
        responses: {
          200: { description: '', content: { 'application/json': { example: { ok: true, message: 'LDAP connection successful' } } } },
          500: { description: 'Connection failed', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
        },
      },
    },

    // ─── LOCAL GROUPS ────────────────────────────────────────────────────────

    '/groups': {
      get: {
        tags: ['Local Groups (Admin)'],
        summary: 'List all local groups',
        responses: {
          200: {
            description: '',
            content: {
              'application/json': {
                example: [{ id: 'uuid', name: 'IT Team', role: 'user', member_count: 3, permissions: { inbox: true } }],
              },
            },
          },
        },
      },
      post: {
        tags: ['Local Groups (Admin)'],
        summary: 'Create a local group',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'role'],
                properties: {
                  name:        { type: 'string', maxLength: 100, example: 'IT Team' },
                  description: { type: 'string', maxLength: 500 },
                  role:        { type: 'string', enum: ['admin', 'user'] },
                  permissions: { type: 'object' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: '', content: { 'application/json': { example: { id: 'uuid', name: 'IT Team' } } } },
        },
      },
    },

    '/groups/{id}': {
      get: {
        tags: ['Local Groups (Admin)'],
        summary: 'Get a group by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: '' }, 404: { description: 'Not found' } },
      },
      put: {
        tags: ['Local Groups (Admin)'],
        summary: 'Update a group',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' }, description: { type: 'string' },
                  role: { type: 'string', enum: ['admin', 'user'] }, permissions: { type: 'object' },
                },
              },
            },
          },
        },
        responses: { 200: { description: '' } },
      },
      delete: {
        tags: ['Local Groups (Admin)'],
        summary: 'Delete a group',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } } },
      },
    },

    '/groups/{id}/members': {
      get: {
        tags: ['Local Groups (Admin)'],
        summary: 'List group members',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: {
            description: '',
            content: { 'application/json': { example: [{ id: 'uuid', username: 'john', role: 'user' }] } },
          },
        },
      },
      post: {
        tags: ['Local Groups (Admin)'],
        summary: 'Add a user to a group',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['userId'], properties: { userId: { type: 'string', format: 'uuid' } } },
            },
          },
        },
        responses: { 200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } } },
      },
    },

    '/groups/{id}/members/{userId}': {
      delete: {
        tags: ['Local Groups (Admin)'],
        summary: 'Remove a user from a group',
        parameters: [
          { name: 'id',     in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { 200: { description: '', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } } },
      },
    },

    // ─── AUDIT ──────────────────────────────────────────────────────────────

    '/audit': {
      get: {
        tags: ['Audit (Superadmin)'],
        summary: 'Get audit log (paginated) — superadmin only',
        description: 'Returns a paginated, filterable list of all audited events. All write operations are audit-logged.\n\n**Logged action types:**\n\n| Action | Triggered by |\n|--------|-------------|\n| `auth:login` | POST /auth/login |\n| `auth:saml_login` | SAML ACS |\n| `auth:saml_logout` | SAML SLO |\n| `user:create` / `user:update` / `user:delete` | User CRUD |\n| `device:create` / `device:update` / `device:delete` | Device CRUD |\n| `port:update` | PUT /ports/…/info or /sim |\n| `rule:create` / `rule:update` / `rule:delete` | Forwarding rules CRUD |\n| `contact:create` / `contact:update` / `contact:delete` | Local phonebook CRUD |\n| `contact:ldap_sync` | POST /phonebook/ldap/sync |\n| `phonebook:settings_update` | PUT /phonebook/settings |\n| `settings:smtp_update` | POST /settings/smtp |\n| `settings:email_template_update` | POST /settings/email-template |\n| `settings:email_subject_update` | POST /settings/email-subject |\n| `settings:saml_update` | POST /settings/saml |\n| `settings:webhook_update` | POST /settings/webhook |\n| `settings:ntp_update` | POST /settings/ntp |\n| `group:create` / `group:update` / `group:delete` | Local groups CRUD |\n| `group:add_member` / `group:remove_member` | Local group membership |\n| `sms:send` | POST /messages/send |',
        parameters: [
          { name: 'page',          in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit',         in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'username',      in: 'query', schema: { type: 'string' } },
          { name: 'action',        in: 'query', schema: { type: 'string' } },
          { name: 'resource_type', in: 'query', schema: { type: 'string' } },
          { name: 'from',          in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to',            in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: {
          200: {
            description: '',
            content: {
              'application/json': {
                example: {
                  data: [{ id: 'uuid', username: 'sysadmin', action: 'create', resource_type: 'user', created_at: '2026-03-01T09:00:00Z' }],
                  total: 1, page: 1, limit: 50,
                },
              },
            },
          },
        },
      },
      delete: {
        tags: ['Audit (Superadmin)'],
        summary: 'Purge audit entries older than N days — superadmin only',
        parameters: [
          { name: 'days', in: 'query', required: true, schema: { type: 'integer', minimum: 1, maximum: 3650 }, description: 'Delete entries older than this many days' },
        ],
        responses: {
          200: { description: '', content: { 'application/json': { example: { ok: true, removed: 42 } } } },
        },
      },
    },

    // ─── PHONEBOOK ──────────────────────────────────────────────────────────

    '/phonebook': {
      get: {
        tags: ['Phonebook'],
        summary: 'Get all contacts (local + LDAP)',
        description: 'Returns all phonebook contacts (local and LDAP). Requires **phonebook** permission (or admin/superadmin). This permission **only** enables the contact picker in the Send SMS UI — the Phonebook management page is accessible to admin/superadmin only regardless of this permission. LDAP contacts are auto-synced on first access when the phonebook_ldap setting is enabled and no LDAP contacts exist yet.',
        responses: {
          200: {
            description: 'List of contacts',
            content: {
              'application/json': {
                example: [
                  { id: 'uuid-1', display_name: 'John Smith', phone: '+12025550100', email: 'john.smith@example.com', notes: '', source: 'local' },
                  { id: 'ldap-abc', display_name: 'Jane Doe', phone: '+12025550199', email: 'jane.doe@example.com', notes: null, source: 'ldap' },
                ],
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Forbidden – phonebook permission required' },
        },
      },
    },

    '/phonebook/local': {
      get: {
        tags: ['Phonebook'],
        summary: 'List local contacts (admin)',
        description: 'Returns all locally managed contacts. **Admin** or **superadmin** only.',
        responses: {
          200: { description: 'Local contacts list', content: { 'application/json': { example: [
            { id: 'uuid-1', display_name: 'John Smith', phone: '+12025550100', email: 'john.smith@example.com', notes: 'CEO', source: 'local' },
          ] } } },
          401: { description: 'Unauthorized' },
          403: { description: 'Forbidden' },
        },
      },
      post: {
        tags: ['Phonebook'],
        summary: 'Create a local contact (admin)',
        description: '**Audit-logged** (`contact:create`).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['display_name', 'phone'],
                properties: {
                  display_name: { type: 'string', example: 'John Smith' },
                  phone:        { type: 'string', example: '+12025550100' },
                  email:        { type: 'string', example: 'john.smith@example.com' },
                  notes:        { type: 'string', example: 'CEO' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Contact created', content: { 'application/json': { example: { id: 'uuid', display_name: 'John Smith', phone: '+12025550100', source: 'local' } } } },
          400: { description: 'Validation error' },
          401: { description: 'Unauthorized' },
          403: { description: 'Forbidden' },
        },
      },
    },

    '/phonebook/local/{id}': {
      put: {
        tags: ['Phonebook'],
        summary: 'Update a local contact (admin)',
        description: '**Audit-logged** (`contact:update`).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Contact ID' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  display_name: { type: 'string' },
                  phone:        { type: 'string' },
                  email:        { type: 'string' },
                  notes:        { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated contact', content: { 'application/json': { example: { id: 'uuid', display_name: 'John Smith', phone: '+12025550100' } } } },
          401: { description: 'Unauthorized' },
          403: { description: 'Forbidden' },
          404: { description: 'Contact not found' },
        },
      },
      delete: {
        tags: ['Phonebook'],
        summary: 'Delete a local contact (admin)',
        description: '**Audit-logged** (`contact:delete`).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Contact ID' }],
        responses: {
          200: { description: 'OK', content: { 'application/json': { example: { ok: true } } } },
          401: { description: 'Unauthorized' },
          403: { description: 'Forbidden' },
          404: { description: 'Contact not found' },
        },
      },
    },

    '/phonebook/ldap': {
      get: {
        tags: ['Phonebook'],
        summary: 'List LDAP contacts from DB (admin)',
        description: 'Returns LDAP contacts already stored in the local database **without** triggering a new LDAP query. Also returns the current sync job state. Use `POST /api/phonebook/ldap/sync` to start a new sync. **Admin** or **superadmin** only.',
        responses: {
          200: {
            description: 'LDAP contacts from DB + current sync status',
            content: {
              'application/json': {
                example: {
                  synced: 1250,
                  contacts: [
                    { id: '550e8400-e29b-41d4-a716-446655440000', display_name: 'Jane Doe', phone: '+12025550199', email: 'jane.doe@example.com', source: 'ldap' },
                  ],
                  syncStatus: { status: 'done', synced: 1250, error: null, startedAt: '2026-03-28T08:00:00.000Z', finishedAt: '2026-03-28T08:01:32.000Z' },
                },
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Forbidden' },
        },
      },
    },

    '/phonebook/ldap/sync': {
      post: {
        tags: ['Phonebook'],
        summary: 'Start background LDAP sync (admin)',
        description: 'Starts an asynchronous LDAP phonebook sync in the background and **returns immediately**. Poll `GET /api/phonebook/ldap/status` every few seconds to follow progress.\n\n**How the sync works:**\n- Queries Active Directory via paged LDAP search (supports 2000+ contacts).\n- Replaces **all** existing LDAP contacts in the local DB atomically in a single transaction: `DELETE FROM contacts WHERE source=\'ldap\'` followed by bulk `INSERT`. Old contacts from a previous sync (e.g. a wider OU) are fully removed — only the contacts from the current `base_dn` remain after the sync.\n- The entire replace is executed as one `db.exec()` call so the event loop stays free even for large datasets.\n- If the phonebook settings form has unsaved changes, the frontend auto-saves them before calling this endpoint so the sync always uses the current `base_dn`.\n\nIf a sync is already running the response has `status: "already_running"`. **Admin** or **superadmin** only. **Audit-logged** (`contact:ldap_sync`).',
        responses: {
          200: {
            description: 'Sync started (or already running)',
            content: {
              'application/json': {
                example: { status: 'started', synced: 0, error: null, startedAt: '2026-03-28T08:00:00.000Z', finishedAt: null },
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Forbidden' },
        },
      },
    },

    '/phonebook/ldap/status': {
      get: {
        tags: ['Phonebook'],
        summary: 'Get current LDAP sync job status (admin)',
        description: 'Returns the in-memory state of the LDAP sync background job. Poll this endpoint every few seconds after calling `POST /api/phonebook/ldap/sync`. State resets to `idle` on server restart. **Admin** or **superadmin** only.',
        responses: {
          200: {
            description: 'Sync job state',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status:      { type: 'string', enum: ['idle', 'running', 'done', 'error'], description: 'Current job status' },
                    synced:      { type: 'integer', description: 'Number of contacts imported in the last completed sync' },
                    error:       { type: 'string', nullable: true, description: 'Error message if status is "error"' },
                    startedAt:   { type: 'string', format: 'date-time', nullable: true },
                    finishedAt:  { type: 'string', format: 'date-time', nullable: true },
                  },
                },
                example: { status: 'running', synced: 0, error: null, startedAt: '2026-03-28T08:00:00.000Z', finishedAt: null },
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Forbidden' },
        },
      },
    },

    '/phonebook/settings': {
      get: {
        tags: ['Phonebook'],
        summary: 'Get phonebook LDAP settings (admin)',
        responses: {
          200: {
            description: 'Phonebook LDAP settings',
            content: {
              'application/json': {
                example: { enabled: true, base_dn: 'OU=Users,DC=example,DC=com', filter: '(objectClass=person)' },
              },
            },
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Forbidden' },
        },
      },
      put: {
        tags: ['Phonebook'],
        summary: 'Save phonebook LDAP settings (admin)',
        description: 'Saves the phonebook-specific LDAP overrides (`base_dn`, `filter`, `enabled`). If `enabled` is set to `false`, all LDAP contacts are removed from the local DB. **Audit-logged** (`phonebook:settings_update`).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  enabled: { type: 'boolean' },
                  base_dn: { type: 'string', example: 'OU=Users,DC=example,DC=com' },
                  filter:  { type: 'string', example: '(objectClass=person)' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Settings saved', content: { 'application/json': { example: { enabled: true, base_dn: 'OU=Users,DC=example,DC=com', filter: '(&(objectClass=user)(mobile=*))' } } } },
          401: { description: 'Unauthorized' },
          403: { description: 'Forbidden' },
        },
      },
    },
  },
};

module.exports = spec;
