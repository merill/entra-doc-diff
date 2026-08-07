#!/usr/bin/env node

const DEFAULT_RECIPIENT = 'merill@merill.net';

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function workflowContext(env = process.env) {
  const repository = env.GITHUB_REPOSITORY || 'merill/entra-doc-diff';
  const runId = env.GITHUB_RUN_ID || '';
  return {
    workflow: env.GITHUB_WORKFLOW || 'Daily Entra Docs Monitor',
    job: env.GITHUB_JOB || 'monitor-docs',
    component: env.FAILURE_COMPONENT || 'refresh',
    repository,
    branch: env.GITHUB_REF_NAME || '',
    commit: env.GITHUB_SHA || '',
    event: env.GITHUB_EVENT_NAME || '',
    runNumber: env.GITHUB_RUN_NUMBER || '',
    runAttempt: env.GITHUB_RUN_ATTEMPT || '1',
    runUrl: env.GITHUB_RUN_URL || (runId ? `https://github.com/${repository}/actions/runs/${runId}` : '')
  };
}

function buildFailureMessage(context, sender, recipient = DEFAULT_RECIPIENT) {
  const runLabel = context.runNumber ? `run ${context.runNumber}` : 'scheduled run';
  const component = context.component || 'refresh';
  const details = [
    ['Component', component],
    ['Workflow', context.workflow],
    ['Job', context.job],
    ['Repository', context.repository],
    ['Branch', context.branch],
    ['Commit', context.commit],
    ['Event', context.event],
    ['Run', context.runNumber],
    ['Attempt', context.runAttempt]
  ].filter(([, value]) => value);
  const rows = details.map(([label, value]) => `<tr><th style="padding:6px 12px 6px 0;text-align:left;vertical-align:top;color:#555">${escapeHtml(label)}</th><td style="padding:6px 0;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`).join('');
  const runLink = context.runUrl
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(context.runUrl)}" style="display:inline-block;padding:11px 16px;border-radius:5px;background:#b42318;color:#fff;text-decoration:none;font-weight:700">Open the failed GitHub Actions run</a></p>`
    : '';

  return {
    subject: `Daily.Entra.News ${component} failed — ${runLabel}`,
    importance: 'high',
    internetMessageHeaders: [
      { name: 'x-entra-docs-monitor', value: 'failure-alert' },
      { name: 'x-entra-docs-encryption', value: 'none' }
    ],
    body: {
      contentType: 'HTML',
      content: `<div style="max-width:680px;margin:0 auto;font-family:Segoe UI,Arial,sans-serif;color:#1f2328"><div style="padding:18px 22px;border-left:5px solid #b42318;background:#fff1f0"><h1 style="margin:0 0 8px;font-size:22px;color:#8a1c13">Daily.Entra.News ${escapeHtml(component)} failed</h1><p style="margin:0;line-height:1.5">The ${escapeHtml(component)} job did not complete. Open the Actions run to review the failure and any delivery impact.</p></div><table style="margin-top:22px;border-collapse:collapse;font-size:14px">${rows}</table>${runLink}<p style="margin-top:24px;color:#666;font-size:12px">This automated alert was sent by the Daily.Entra.News GitHub Actions workflow.</p></div>`
    },
    toRecipients: [{ emailAddress: { address: recipient } }],
    from: { emailAddress: { address: sender } }
  };
}

async function responseError(response) {
  const body = await response.text().catch(() => '');
  return `${response.status} ${response.statusText || ''}${body ? `: ${body.slice(0, 500)}` : ''}`.trim();
}

async function sendFailureEmail({ env = process.env, fetchImpl = global.fetch } = {}) {
  const required = ['AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID', 'SENDER_EMAIL'];
  const missing = required.filter(name => !env[name]);
  if (missing.length) throw new Error(`Missing failure-email configuration: ${missing.join(', ')}`);

  const tokenResponse = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(env.AZURE_TENANT_ID)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.AZURE_CLIENT_ID,
      client_secret: env.AZURE_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    })
  });
  if (!tokenResponse.ok) throw new Error(`Unable to authenticate failure email: ${await responseError(tokenResponse)}`);
  const token = await tokenResponse.json();
  if (!token.access_token) throw new Error('Unable to authenticate failure email: access token was not returned');

  const sender = env.SENDER_EMAIL;
  const recipient = env.FAILURE_RECIPIENT_EMAIL || DEFAULT_RECIPIENT;
  const message = buildFailureMessage(workflowContext(env), sender, recipient);
  const sendResponse = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token.access_token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ message, saveToSentItems: true })
  });
  if (!sendResponse.ok) throw new Error(`Unable to send failure email: ${await responseError(sendResponse)}`);

  console.log(`Failure alert emailed to ${recipient}`);
  return message;
}

async function main() {
  try {
    await sendFailureEmail();
  } catch (error) {
    console.error(`Failure alert could not be sent: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  DEFAULT_RECIPIENT,
  buildFailureMessage,
  escapeHtml,
  sendFailureEmail,
  workflowContext
};
