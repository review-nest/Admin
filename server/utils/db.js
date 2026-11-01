const { db } = require('../config/firebase');

/**
 * Fetch a whole collection (optionally only some fields). Always pass `select` for
 * collections that hold large fields (submissions.screenshotBase64!).
 */
async function fetchAll(col, { select, where, limit = 10000 } = {}) {
  let q = db.collection(col);
  (where || []).forEach(([f, op, v]) => { q = q.where(f, op, v); });
  if (select && select.length) q = q.select(...select);
  const snap = await q.limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getDoc(col, id) {
  const s = await db.collection(col).doc(id).get();
  return s.exists ? { id: s.id, ...s.data() } : null;
}

// Light field lists (never include screenshotBase64 here)
const SUB_LIGHT = [
  'taskId', 'taskTitle', 'userId', 'userName', 'userEmail', 'rewardAmount', 'status', 'proofText',
  'adminNote', 'rejectionReason', 'createdAt', 'updatedAt', 'reviewedAt', 'reviewedBy', 'imageHash',
  'feedbackPromptId', 'timestamp',
];
const USER_LIGHT = [
  'fullName', 'email', 'phone', 'walletBalance', 'completedTasksCount', 'isBanned', 'banReason', 'accountStatus',
  'createdAt', 'lastActiveAt', 'lastSeen', 'lastHeartbeat', 'updatedAt',
];
const WD_FIELDS = [
  'userId', 'userName', 'userEmail', 'amount', 'status', 'createdAt', 'updatedAt', 'processedAt', 'paidAt',
  'upiId', 'bankName', 'accountNumber', 'ifscCode', 'accountHolderName', 'utrNumber', 'transactionRef',
  'paidAmount', 'adminNote', 'rejectionReason', 'processedBy', 'method',
];
const TASK_LIGHT = [
  'title', 'appName', 'iconUrl', 'appIcon', 'taskPfpBase64', 'rewardInr', 'rewardAmount', 'status', 'active',
  'appId', 'storeUrl', 'createdAt', 'updatedAt', 'taskCap', 'blockedUserIds',
];

module.exports = { fetchAll, getDoc, SUB_LIGHT, USER_LIGHT, WD_FIELDS, TASK_LIGHT };
