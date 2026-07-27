import assert from 'node:assert/strict';
import test from 'node:test';
import { FreshsalesClient, FreshsalesError } from '../src/freshsales.js';

test('searchContacts builds an authenticated Freshsales search request', async () => {
  let requestUrl = '';
  let auth = '';
  const fakeFetch: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    auth = new Headers(init?.headers).get('authorization') || '';
    return new Response(JSON.stringify([{ id: 12, name: 'Robert Mele', type: 'contact' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const client = new FreshsalesClient('https://example.myfreshworks.com/crm/sales', 'secret', fakeFetch);
  const result = await client.searchContacts('Robert Mele', 25);

  assert.equal(auth, 'Token token=secret');
  assert.match(requestUrl, /\/api\/search\?/);
  assert.match(requestUrl, /q=Robert\+Mele/);
  assert.match(requestUrl, /include=contact/);
  assert.deepEqual(result, [{ id: 12, name: 'Robert Mele', type: 'contact' }]);
});

test('createTask uses the documented Freshsales task shape', async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ task: { id: 9 } }), { status: 200 });
  };
  const client = new FreshsalesClient('https://example.myfreshworks.com/crm/sales', 'secret', fakeFetch);
  await client.createTask({
    targetableId: 44,
    targetableType: 'Contact',
    ownerId: 2,
    title: 'Follow up',
    description: 'Call about lunch meeting',
    dueDate: '2026-07-14T10:00:00-04:00',
    status: 0
  });

  assert.deepEqual(body.task, {
    title: 'Follow up',
    description: 'Call about lunch meeting',
    due_date: '2026-07-14T10:00:00-04:00',
    owner_id: 2,
    targetable_id: 44,
    targetable_type: 'Contact',
    status: 0,
    task_users_attributes: [{ user_id: 2 }]
  });
});

test('generic record helpers use the correct Freshsales entity root and method', async () => {
  const requests: Array<{ url: string; method: string; body?: any }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: String(init?.method),
      body: init?.body ? JSON.parse(String(init.body)) : undefined
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const client = new FreshsalesClient('https://example.myfreshworks.com/crm/sales', 'secret', fakeFetch);

  await client.createEntity('sales_accounts', { name: 'Reliable Plumbing' });
  await client.updateEntity('deals', 8, { amount: 1500 });
  await client.deleteEntity('contacts', 4);

  assert.equal(requests[0].method, 'POST');
  assert.match(requests[0].url, /\/api\/sales_accounts$/);
  assert.deepEqual(requests[0].body, { sales_account: { name: 'Reliable Plumbing' } });
  assert.equal(requests[1].method, 'PUT');
  assert.match(requests[1].url, /\/api\/deals\/8$/);
  assert.deepEqual(requests[1].body, { deal: { amount: 1500 } });
  assert.equal(requests[2].method, 'DELETE');
  assert.match(requests[2].url, /\/api\/contacts\/4$/);
});

test('bulk contact upsert enforces the documented request envelope', async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ job_status_url: '/api/job_statuses/abc' }), { status: 202 });
  };
  const client = new FreshsalesClient('https://example.myfreshworks.com/crm/sales', 'secret', fakeFetch);
  const contacts = [{
    emails: 'owner@example.com',
    data: { first_name: 'Alex', last_name: 'Owner' }
  }];

  await client.bulkUpsertContacts(contacts);
  assert.deepEqual(body, { contacts });
});

test('appointment and sales activity writes use documented envelopes', async () => {
  const requests: any[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const client = new FreshsalesClient('https://example.myfreshworks.com/crm/sales', 'secret', fakeFetch);

  await client.createAppointment({
    title: 'Coffee meeting',
    from_date: '2026-07-30T10:00:00-04:00',
    end_date: '2026-07-30T10:30:00-04:00',
    targetable_id: 3,
    targetable_type: 'Contact'
  });
  await client.createSalesActivity({
    title: 'Qualification call',
    sales_activity_type_id: 2,
    targetable_id: 3,
    targetable_type: 'Contact'
  });

  assert.equal(requests[0].appointment.title, 'Coffee meeting');
  assert.equal(requests[1].sales_activity.title, 'Qualification call');
});

test('API errors are returned as FreshsalesError without exposing the API key', async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({ errors: { message: 'Forbidden' } }), { status: 403 });
  const client = new FreshsalesClient('https://example.myfreshworks.com/crm/sales', 'super-secret', fakeFetch);

  await assert.rejects(client.healthCheck(), (error: unknown) => {
    assert.ok(error instanceof FreshsalesError);
    assert.equal(error.status, 403);
    assert.doesNotMatch(error.message, /super-secret/);
    return true;
  });
});
