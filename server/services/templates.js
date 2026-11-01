/** Ready-made notification templates. {placeholders} are filled in by the admin before sending. */
const TEMPLATES = [
  { id: 'new_task', name: 'New task available', type: 'offer', title: 'New task available: {appName}', message: 'A new task for {appName} is live. Open the app to see the details.' },
  { id: 'task_reminder', name: 'Task reminder', type: 'alert', title: 'Your task is waiting', message: 'You started a task for {appName}. Upload your proof before the timer ends.' },
  { id: 'submission_received', name: 'Submission received', type: 'broadcast', title: 'Submission received', message: 'We received your proof for {appName}. It is now in review.' },
  { id: 'approval_completed', name: 'Approval completed', type: 'broadcast', title: 'Task approved', message: 'Your task for {appName} was approved and {reward} was added to your wallet.' },
  { id: 'submission_rejected', name: 'Submission rejected (with reason)', type: 'alert', title: 'Submission needs changes', message: 'Your proof for {appName} was not accepted. Reason: {reason}' },
  { id: 'withdrawal_received', name: 'Withdrawal received', type: 'broadcast', title: 'Withdrawal request received', message: 'We received your withdrawal request. We will update you once it is processed.' },
  { id: 'withdrawal_paid', name: 'Withdrawal processed / paid', type: 'broadcast', title: 'Withdrawal paid', message: 'Your withdrawal has been paid. Check your payment app for the credit.' },
  { id: 'maintenance_notice', name: 'Maintenance notice', type: 'alert', title: 'Scheduled maintenance', message: 'The app will be under maintenance for a short time. We will be back shortly.' },
];

/** Notifications show on lock screens, so block anything that looks like payment / personal data. */
function findSensitive(text) {
  const t = String(text || '');
  const problems = [];
  if (/\b\d{9,18}\b/.test(t)) problems.push('a long number (looks like an account or phone number)');
  if (/[a-z0-9._-]{2,}@[a-z]{2,}/i.test(t)) problems.push('an email or UPI ID');
  if (/\b[A-Z]{4}0[A-Z0-9]{6}\b/.test(t)) problems.push('an IFSC code');
  return problems;
}

module.exports = { TEMPLATES, findSensitive };
