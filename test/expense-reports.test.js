'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const expenses = require('../expense-reports');
const { AGENT_CARD } = require('../agent-card');

test('agent card is a well-formed NANDA identity', () => {
  assert.equal(AGENT_CARD.name, 'Livia');
  assert.equal(AGENT_CARD.protocol, 'NANDA/1.0');
  assert.match(AGENT_CARD.version, /^\d+\.\d+\.\d+$/);
  assert.equal(AGENT_CARD.version, require('../package.json').version);
  assert.ok(AGENT_CARD.capabilities.length > 0);
});

test('every advertised capability that names an endpoint has one', () => {
  for (const cap of ['expense-capture', 'expense-reports', 'briefing', 'document-vault']) {
    assert.ok(AGENT_CARD.capabilities.includes(cap), `${cap} missing from capabilities`);
  }
  for (const key of ['expenses', 'expenseReports', 'briefing', 'vault', 'agentCard', 'status']) {
    assert.ok(AGENT_CARD.endpoints[key], `${key} missing from endpoints`);
  }
});

function tripReport(policy) {
  return expenses.createReport(
    { purpose: 'LP roadshow', destination: 'New York', traveler: 'A. Principal' }, policy);
}


test('a report requires a purpose and starts empty', () => {
  assert.throws(() => expenses.createReport({}), /purpose/);
  const r = tripReport();
  assert.match(r.id, /^EXP-[0-9A-F]{12}$/);
  assert.equal(r.status, 'draft');
  assert.equal(expenses.totalAmount(r), 0);
});

test('line items must use a known category and a valid amount', () => {
  const r = tripReport();
  assert.throws(() => expenses.addLineItem(r, { category: 'yacht', amount: 10 }), /Unknown category/);
  assert.throws(() => expenses.addLineItem(r, { category: 'meals', amount: -5 }), /non-negative/);
});

test('mileage is computed from distance, not from a claimed amount', () => {
  const r = tripReport();
  // An inflated amount must be ignored in favour of units x the policy rate.
  const line = expenses.addLineItem(r, { category: 'mileage', units: 100, amount: 9999, hasReceipt: true });
  assert.equal(line.amount, Math.round(100 * r.policy.mileageRate * 100) / 100);
});

test('per diems are receipt-exempt and scale with days', () => {
  const r = tripReport();
  const line = expenses.addPerDiem(r, { days: 3, kind: 'meals' });
  assert.equal(line.amount, 3 * r.policy.perDiem.meals);
  assert.equal(line.hasReceipt, true);
  assert.throws(() => expenses.addPerDiem(r, { days: 0 }), /positive/);
});

test('caps are applied per unit, so a long stay is not falsely flagged', () => {
  const r = tripReport();
  // 5 nights at 400/night is within the 450 cap even though the total is 2000.
  expenses.addLineItem(r, { category: 'lodging', amount: 2000, units: 5, hasReceipt: true });
  assert.equal(expenses.checkPolicy(r).compliant, true);

  const over = tripReport();
  expenses.addLineItem(over, { category: 'lodging', amount: 3000, units: 5, hasReceipt: true });
  const check = expenses.checkPolicy(over);
  assert.equal(check.compliant, false);
  assert.equal(check.violations[0].overBy, 150);
});

test('a missing receipt above the threshold is a violation', () => {
  const r = tripReport();
  expenses.addLineItem(r, { category: 'meals', amount: 80, hasReceipt: false });
  assert.match(expenses.checkPolicy(r).violations[0].message, /receipt/i);

  const small = tripReport();
  expenses.addLineItem(small, { category: 'incidentals', amount: 10, hasReceipt: false });
  assert.equal(expenses.checkPolicy(small).compliant, true, 'below the threshold needs no receipt');
});

test('a justification downgrades a cap breach to a warning', () => {
  const r = tripReport();
  expenses.addLineItem(r, {
    category: 'entertainment', amount: 900, hasReceipt: true,
    justification: 'Anchor LP dinner, six attendees, approved in advance.',
  });
  const check = expenses.checkPolicy(r);
  assert.equal(check.compliant, true, 'a justified breach must not block submission');
  assert.equal(check.warnings.length, 1);
  assert.equal(check.warnings[0].justified, true);
});

test('submission is blocked while unjustified violations remain', () => {
  const r = tripReport();
  expenses.addLineItem(r, { category: 'meals', amount: 80, hasReceipt: false });

  const blocked = expenses.submit(r, { submittedBy: 'livia' });
  assert.equal(blocked.ok, false);
  assert.equal(r.status, 'draft', 'a blocked submission must not advance the report');
  assert.ok(blocked.violations.length > 0);
});

test('an empty report cannot be submitted', () => {
  assert.throws(() => expenses.submit(tripReport()), /empty/);
});

test('large reports escalate to a second approver', () => {
  const small = tripReport();
  expenses.addLineItem(small, { category: 'airfare', amount: 900, hasReceipt: true });
  assert.equal(expenses.submit(small).approvalsRequired, 1);

  const large = tripReport();
  expenses.addLineItem(large, { category: 'airfare', amount: 4000, hasReceipt: true });
  assert.equal(expenses.submit(large).approvalsRequired, 2);
});

test('approval completes only once enough approvers have signed', () => {
  const r = tripReport();
  expenses.addLineItem(r, { category: 'airfare', amount: 4000, hasReceipt: true });
  expenses.submit(r);

  let res = expenses.approve(r, { approvedBy: 'cfo@fund.com' });
  assert.equal(res.status, 'submitted', 'one of two approvals is not enough');

  assert.equal(expenses.approve(r, { approvedBy: 'cfo@fund.com' }).ok, false, 'no double sign-off');

  res = expenses.approve(r, { approvedBy: 'coo@fund.com' });
  assert.equal(res.status, 'approved');
  assert.ok(r.approvedAt);
});

test('rejection returns the report to the traveller and allows resubmission', () => {
  const r = tripReport();
  expenses.addLineItem(r, { category: 'lodging', amount: 300, units: 1, hasReceipt: true });
  expenses.submit(r);

  expenses.reject(r, { rejectedBy: 'cfo@fund.com', reason: 'Split the hotel across cost centres.' });
  assert.equal(r.status, 'rejected');
  assert.equal(expenses.submit(r).ok, true, 'a rejected report can be resubmitted');
});

test('the summary totals by category and names the largest', () => {
  const r = tripReport();
  expenses.addLineItem(r, { category: 'airfare', amount: 1800, hasReceipt: true });
  expenses.addLineItem(r, { category: 'lodging', amount: 400, units: 1, hasReceipt: true });
  expenses.addPerDiem(r, { days: 2 });

  const s = expenses.summarise(r);
  assert.equal(s.largestCategory, 'airfare');
  assert.equal(s.total, expenses.totalAmount(r));
  assert.equal(s.lineItemCount, 3);
});

// ── Bridge to the expense register ──────────────────────────────────────────

/** A record shaped like one the register produces from an inbound invoice. */
function captured(overrides = {}) {
  return {
    id: 'exp_1234567890_abcde',
    date: '2026-03-04T09:00:00.000Z',
    vendor: 'Hilton Midtown',
    amount: 380,
    currency: 'EUR',
    description: 'Two nights, conference rate',
    type: 'accommodation',
    manual: false,
    ...overrides,
  };
}

test('a captured invoice can be claimed without re-keying it', () => {
  const r = tripReport();
  const line = expenses.fromCapturedExpense(r, captured());

  assert.equal(line.category, 'lodging', 'accommodation maps to lodging');
  assert.equal(line.amount, 380);
  assert.equal(line.hasReceipt, true, 'a register entry exists because a document produced it');
  assert.equal(line.capturedExpenseId, 'exp_1234567890_abcde');
  assert.match(line.description, /Hilton Midtown/);
  assert.equal(expenses.totalAmount(r), 380);
});

test('the same invoice cannot be claimed twice on one report', () => {
  const r = tripReport();
  expenses.fromCapturedExpense(r, captured());
  assert.throws(() => expenses.fromCapturedExpense(r, captured()), /already been claimed/);
});

test('every register type maps to a real claim category', () => {
  const types = ['invoice', 'receipt', 'subscription', 'travel', 'meal', 'accommodation', 'utilities', 'other'];
  for (const type of types) {
    const r = tripReport();
    const line = expenses.fromCapturedExpense(r, captured({ type }));
    assert.ok(
      expenses.CATEGORIES.includes(line.category),
      `type "${type}" mapped to unknown category "${line.category}"`,
    );
  }
});

test('an unmapped type books to incidentals rather than being dropped', () => {
  const r = tripReport();
  const line = expenses.fromCapturedExpense(r, captured({ type: 'something_new' }));
  assert.equal(line.category, 'incidentals');
});

test('a claimed invoice still counts toward policy checks', () => {
  const r = tripReport();
  // 600/night is over the 450 cap; claiming it must not bypass the check.
  expenses.fromCapturedExpense(r, captured({ amount: 600, type: 'accommodation' }));
  const check = expenses.checkPolicy(r);
  assert.equal(check.compliant, false);
  assert.equal(check.violations[0].overBy, 150);
});
