/**
 * LIVIA — Trip expense reports
 *
 * Complements the expense *register* in server.js rather than replacing it.
 * The register captures what arrives — invoices and receipts auto-detected from
 * inbound email and Telegram. This module handles what goes out: turning a trip
 * into a submittable, policy-checked claim with per diems, mileage, spend caps,
 * and an approval chain.
 *
 * The two meet at `fromCapturedExpense`, which pulls an already-captured
 * register entry into a report as a line item, so a receipt Livia logged from
 * an email can be claimed without re-keying it.
 *
 * Pure functions over plain data — no I/O, so server.js owns persistence.
 */

'use strict';

const crypto = require('crypto');

/** Expense categories an EA files against. */
const CATEGORIES = [
  'airfare', 'lodging', 'ground_transport', 'meals', 'entertainment',
  'conference', 'mileage', 'incidentals',
];

/**
 * Default policy. Amounts are per unit in the report's currency; a null cap
 * means unlimited but still receipted.
 */
const DEFAULT_POLICY = {
  currency: 'EUR',
  perDiem: { meals: 90, incidentals: 25 },
  mileageRate: 0.67,               // per mile
  caps: {
    lodging: 450,                  // per night
    meals: 150,                    // per day, above per diem needs justification
    entertainment: 500,            // per event
    ground_transport: 200,         // per journey
    airfare: null,
    conference: null,
    mileage: null,
    incidentals: 75,
  },
  receiptRequiredAbove: 25,
  approvalThreshold: 2500,         // total above this needs a second approver
};

// ── Report lifecycle ────────────────────────────────────────────────────────

/**
 * Open a report for a trip.
 *
 * @param {object} trip
 * @param {string} trip.purpose
 * @param {string} [trip.destination]
 * @param {string} [trip.startDate] — ISO date
 * @param {string} [trip.endDate]   — ISO date
 * @param {string} [trip.traveler]
 * @param {object} [policy] — overrides merged over DEFAULT_POLICY
 */
function createReport(trip = {}, policy = {}) {
  if (!trip.purpose) throw new Error('A trip purpose is required.');

  return {
    id: 'EXP-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
    purpose: trip.purpose,
    destination: trip.destination || null,
    startDate: trip.startDate || null,
    endDate: trip.endDate || null,
    traveler: trip.traveler || null,
    policy: mergePolicy(policy),
    lineItems: [],
    status: 'draft',
    createdAt: new Date().toISOString(),
  };
}

function mergePolicy(policy = {}) {
  return {
    ...DEFAULT_POLICY,
    ...policy,
    perDiem: { ...DEFAULT_POLICY.perDiem, ...(policy.perDiem || {}) },
    caps:    { ...DEFAULT_POLICY.caps,    ...(policy.caps || {}) },
  };
}

/**
 * Add a line item. Returns the created item; mutates the report.
 *
 * @param {object} report
 * @param {object} item
 * @param {string} item.category — one of CATEGORIES
 * @param {number} item.amount
 * @param {string} [item.description]
 * @param {string} [item.date]
 * @param {boolean} [item.hasReceipt]
 * @param {number} [item.units] — nights for lodging, days for meals, miles for mileage
 */
function addLineItem(report, item = {}) {
  if (!report || !Array.isArray(report.lineItems)) throw new Error('A report is required.');
  if (!CATEGORIES.includes(item.category)) {
    throw new Error(`Unknown category "${item.category}". Expected one of: ${CATEGORIES.join(', ')}.`);
  }

  const units = Number.isFinite(item.units) && item.units > 0 ? item.units : 1;

  // Mileage is claimed by distance, not by amount.
  const amount = item.category === 'mileage'
    ? round2(units * report.policy.mileageRate)
    : Number(item.amount);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('A non-negative amount is required.');
  }

  const line = {
    id: 'LI-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    category: item.category,
    description: item.description || '',
    date: item.date || null,
    units,
    amount,
    hasReceipt: !!item.hasReceipt,
    justification: item.justification || null,
  };

  report.lineItems.push(line);
  return line;
}

/** Per-diem line for a stretch of days. */
function addPerDiem(report, { days, kind = 'meals', date = null }) {
  if (!Number.isFinite(days) || days <= 0) throw new Error('days must be a positive number.');
  const rate = report.policy.perDiem[kind];
  if (rate == null) throw new Error(`No per diem configured for "${kind}".`);

  return addLineItem(report, {
    category: kind === 'meals' ? 'meals' : 'incidentals',
    description: `Per diem — ${kind} (${days} day${days === 1 ? '' : 's'})`,
    date,
    units: days,
    amount: round2(days * rate),
    hasReceipt: true, // per diems are receipt-exempt by definition
  });
}

/**
 * The register's expense `type` mapped onto a claim category. Anything without
 * a clear counterpart books to incidentals rather than being silently dropped.
 */
const TYPE_TO_CATEGORY = {
  travel:        'airfare',
  accommodation: 'lodging',
  meal:          'meals',
  receipt:       'incidentals',
  invoice:       'incidentals',
  subscription:  'incidentals',
  utilities:     'incidentals',
  other:         'incidentals',
};

/**
 * Claim an expense already captured in the register.
 *
 * @param {object} report
 * @param {object} captured — a record from the `expenses` register
 * @returns {object} the created line item
 */
function fromCapturedExpense(report, captured) {
  if (!captured || typeof captured !== 'object') throw new Error('A captured expense is required.');
  if (report.lineItems.some(l => l.capturedExpenseId && l.capturedExpenseId === captured.id)) {
    throw new Error(`Expense ${captured.id} has already been claimed on this report.`);
  }

  const line = addLineItem(report, {
    category:    TYPE_TO_CATEGORY[captured.type] || 'incidentals',
    amount:      Number(captured.amount),
    description: [captured.vendor, captured.description].filter(Boolean).join(' — ').slice(0, 500),
    date:        captured.date || null,
    // The register only holds an entry because a document produced it, so the
    // receipt requirement is already satisfied.
    hasReceipt:  true,
  });

  line.capturedExpenseId = captured.id;
  line.vendor = captured.vendor || null;
  return line;
}

// ── Policy ──────────────────────────────────────────────────────────────────

/**
 * Check every line against policy.
 *
 * @returns {{ compliant, violations, warnings, total, requiresSecondApprover }}
 */
function checkPolicy(report) {
  if (!report) throw new Error('A report is required.');
  const { caps, receiptRequiredAbove, approvalThreshold } = report.policy;

  const violations = [];
  const warnings = [];

  for (const line of report.lineItems) {
    const cap = caps[line.category];
    if (cap != null) {
      // Caps are per unit — a five-night stay is checked per night.
      const perUnit = round2(line.amount / (line.units || 1));
      if (perUnit > cap) {
        const entry = {
          lineItemId: line.id,
          category: line.category,
          message: `${line.category} at ${perUnit} exceeds the ${cap} per-unit cap.`,
          overBy: round2(perUnit - cap),
        };
        // A documented reason downgrades a breach to a warning for the approver.
        if (line.justification) warnings.push({ ...entry, justified: true });
        else violations.push(entry);
      }
    }

    if (line.amount > receiptRequiredAbove && !line.hasReceipt) {
      violations.push({
        lineItemId: line.id,
        category: line.category,
        message: `A receipt is required for amounts above ${receiptRequiredAbove}.`,
      });
    }
  }

  const total = totalAmount(report);

  return {
    compliant: violations.length === 0,
    violations,
    warnings,
    total,
    requiresSecondApprover: total > approvalThreshold,
  };
}

/** Report total. */
function totalAmount(report) {
  return round2(report.lineItems.reduce((sum, l) => sum + l.amount, 0));
}

/** Totals per category, descending. */
function summarise(report) {
  const byCategory = {};
  for (const line of report.lineItems) {
    byCategory[line.category] = round2((byCategory[line.category] || 0) + line.amount);
  }
  const total = totalAmount(report);

  return {
    reportId: report.id,
    purpose: report.purpose,
    destination: report.destination,
    currency: report.policy.currency,
    lineItemCount: report.lineItems.length,
    total,
    byCategory: Object.fromEntries(
      Object.entries(byCategory).sort((a, b) => b[1] - a[1]),
    ),
    largestCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
  };
}

// ── Submission ──────────────────────────────────────────────────────────────

/**
 * Submit for approval. Refuses while unjustified policy violations remain —
 * an EA chasing a rejected report costs more than blocking it here.
 */
function submit(report, { submittedBy } = {}) {
  if (report.status !== 'draft' && report.status !== 'rejected') {
    throw new Error(`Cannot submit a report in "${report.status}" status.`);
  }
  if (!report.lineItems.length) throw new Error('Cannot submit an empty report.');

  const policy = checkPolicy(report);
  if (!policy.compliant) {
    return {
      ok: false,
      status: report.status,
      reason: 'Policy violations must be resolved or justified before submission.',
      violations: policy.violations,
    };
  }

  report.status = 'submitted';
  report.submittedAt = new Date().toISOString();
  report.submittedBy = submittedBy || report.traveler || null;
  report.approvalsRequired = policy.requiresSecondApprover ? 2 : 1;
  report.approvals = [];

  return { ok: true, status: report.status, approvalsRequired: report.approvalsRequired, total: policy.total };
}

/** Record an approval; the report clears once enough are in. */
function approve(report, { approvedBy, notes = '' } = {}) {
  if (report.status !== 'submitted') {
    throw new Error(`Cannot approve a report in "${report.status}" status.`);
  }
  if (!approvedBy) throw new Error('approvedBy is required.');
  if (report.approvals.some(a => a.approvedBy === approvedBy)) {
    return { ok: false, reason: 'This approver has already signed off.' };
  }

  report.approvals.push({ approvedBy, notes, at: new Date().toISOString() });

  if (report.approvals.length >= report.approvalsRequired) {
    report.status = 'approved';
    report.approvedAt = new Date().toISOString();
  }
  return {
    ok: true,
    status: report.status,
    approvalsReceived: report.approvals.length,
    approvalsRequired: report.approvalsRequired,
  };
}

/** Send back for correction. */
function reject(report, { rejectedBy, reason = '' } = {}) {
  if (report.status !== 'submitted') {
    throw new Error(`Cannot reject a report in "${report.status}" status.`);
  }
  report.status = 'rejected';
  report.rejectedBy = rejectedBy || null;
  report.rejectionReason = reason;
  report.rejectedAt = new Date().toISOString();
  return { ok: true, status: report.status, reason };
}

function round2(n) { return Math.round(n * 100) / 100; }

module.exports = {
  CATEGORIES,
  TYPE_TO_CATEGORY,
  fromCapturedExpense,
  DEFAULT_POLICY,
  createReport,
  addLineItem,
  addPerDiem,
  checkPolicy,
  totalAmount,
  summarise,
  submit,
  approve,
  reject,
};
