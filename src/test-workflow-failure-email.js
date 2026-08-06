const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildFailureMessage,
  sendFailureEmail,
  workflowContext
} = require('../scripts/send-workflow-failure-email');

const environment = {
  AZURE_CLIENT_ID: 'client-id',
  AZURE_CLIENT_SECRET: 'client-secret',
  AZURE_TENANT_ID: 'tenant-id',
  SENDER_EMAIL: 'sender@example.com',
  FAILURE_RECIPIENT_EMAIL: 'merill@merill.net',
  GITHUB_REPOSITORY: 'merill/entra-doc-diff',
  GITHUB_WORKFLOW: 'Daily Entra Docs Monitor',
  GITHUB_JOB: 'monitor-docs',
  GITHUB_REF_NAME: 'main',
  GITHUB_SHA: 'abc123',
  GITHUB_EVENT_NAME: 'schedule',
  GITHUB_RUN_ID: '123456',
  GITHUB_RUN_NUMBER: '396',
  GITHUB_RUN_ATTEMPT: '2'
};

test('failure message is high importance, unlabeled, and links to the failed run', () => {
  const message = buildFailureMessage(workflowContext(environment), environment.SENDER_EMAIL, environment.FAILURE_RECIPIENT_EMAIL);

  assert.equal(message.subject, 'Daily.Entra.News refresh failed — run 396');
  assert.equal(message.importance, 'high');
  assert.equal(Object.hasOwn(message, 'sensitivity'), false);
  assert.deepEqual(message.internetMessageHeaders, [
    { name: 'x-entra-docs-monitor', value: 'failure-alert' },
    { name: 'x-entra-docs-encryption', value: 'none' }
  ]);
  assert.equal(message.toRecipients[0].emailAddress.address, 'merill@merill.net');
  assert.equal(message.from.emailAddress.address, 'sender@example.com');
  assert.match(message.body.content, /https:\/\/github\.com\/merill\/entra-doc-diff\/actions\/runs\/123456/);
  assert.match(message.body.content, /abc123/);
});

test('failure email authenticates and sends through Microsoft Graph', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) {
      return { ok: true, json: async () => ({ access_token: 'graph-token' }) };
    }
    return { ok: true };
  };

  const message = await sendFailureEmail({ env: environment, fetchImpl });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token');
  assert.equal(requests[0].options.body.get('client_secret'), 'client-secret');
  assert.equal(requests[1].url, 'https://graph.microsoft.com/v1.0/users/sender%40example.com/sendMail');
  assert.equal(requests[1].options.headers.authorization, 'Bearer graph-token');
  const payload = JSON.parse(requests[1].options.body);
  assert.equal(payload.saveToSentItems, true);
  assert.equal(payload.message.subject, message.subject);
});

test('workflow runs the alert step only after a failure', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-docs-monitor.yml'), 'utf8');
  assert.match(workflow, /notify-failure:\n\s+name: Email Merill when the refresh fails\n\s+needs: monitor-docs\n\s+if: always\(\) && needs\.monitor-docs\.result == 'failure'/);
  assert.match(workflow, /FAILURE_RECIPIENT_EMAIL: "merill@merill\.net"/);
  assert.match(workflow, /node scripts\/send-workflow-failure-email\.js/);
});
