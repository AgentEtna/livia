/**
 * LIVIA — Agent card
 *
 * NANDA-compliant machine-readable identity, served at /agent-card.
 *
 * Lets Livia be discovered and addressed by other agents rather than only by a
 * human through the dashboard — the same identity contract the sibling
 * Tabularum agents (Gaio, Lucio, Mila, Clara) publish.
 *
 * Capabilities are listed only where a corresponding endpoint exists: the card
 * is a contract, so advertising something unimplemented is a defect.
 */

'use strict';

const { version } = require('./package.json');

const AGENT_CARD = {
  name: 'Livia',
  version,
  protocol: 'NANDA/1.0',
  role: 'Executive Assistant',
  description:
    'Executive Assistant — inbox triage and drafting, calendar and scheduling, contacts and CRM, ' +
    'outreach campaigns, briefings, a document vault, an expense register with automatic invoice ' +
    'capture, and policy-checked trip expense claims.',
  owner: { name: process.env.OWNER_NAME || 'Owner' },

  capabilities: [
    'email-triage',
    'email-drafting',
    'calendar-management',
    'meeting-scheduling',
    'contacts-crm',
    'outreach-campaigns',
    'briefing',
    'document-vault',
    'expense-capture',
    'expense-reports',
    'persistent-rules',
    'scheduled-send',
  ],

  endpoints: {
    agentCard:        '/agent-card',
    status:           '/api/status',
    briefing:         '/api/briefing',
    contacts:         '/api/contacts',
    profiles:         '/api/profiles',
    campaigns:        '/api/campaigns',
    threads:          '/api/threads',
    vault:            '/api/vault',
    rules:            '/api/rules',
    expenses:         '/api/expenses',
    expenseReports:   '/api/expense-reports',
  },

  integrations: ['gmail', 'google-calendar', 'google-contacts', 'telegram'],

  security: {
    authentication: 'Bearer token (DASHBOARD_PASSWORD)',
    cors:           'ALLOWED_ORIGINS whitelist',
    rateLimiting:   true,
    injectionGuard: 'untrusted_content tag boundary',
  },
};

module.exports = { AGENT_CARD };
