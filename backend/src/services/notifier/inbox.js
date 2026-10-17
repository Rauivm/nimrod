import { emailAvailable, deliverEmail } from './email.js';
import { enqueueNotification } from './queue.js';
import { query } from '../../db/index.js';
export async function createUserNotification(client, userId, missionId, type, message, email = false) {
  const entry = (await client.query(`INSERT INTO user_notifications(user_id,mission_id,type,message,email_status)
    VALUES($1,$2,$3,$4,$5) RETURNING id`, [userId, missionId, type, message, email ? 'PENDING' : 'NOT_REQUESTED'])).rows[0];
  if (email) client.afterCommit.push(() => enqueueNotification({
    type: 'inbox-email',
    notificationId: entry.id
  }));
}
export async function deliverInboxEmail(notificationId) {
  const entry = (await query(`SELECT n.*,u.email FROM user_notifications n JOIN users u ON u.id=n.user_id
    WHERE n.id=$1 AND n.email_status IN ('PENDING','FAILED')`, [notificationId])).rows[0];
  if (!entry) return;
  try {
    await deliverEmail({
      to: entry.email,
      subject: 'Nimrod — vaga disponível',
      text: entry.message,
      idempotencyKey: entry.id
    });
    await query("UPDATE user_notifications SET email_status='SENT' WHERE id=$1", [entry.id]);
  } catch (error) {
    await query("UPDATE user_notifications SET email_status=$2,email_attempts=email_attempts+1 WHERE id=$1", [entry.id, emailAvailable() ? 'FAILED' : 'UNAVAILABLE']);
    throw error;
  }
}
export async function recoverPendingEmail() {
  if (!emailAvailable()) return;
  const rows = (await query("SELECT id FROM user_notifications WHERE email_status IN ('PENDING','FAILED') AND email_attempts<3 ORDER BY created_at LIMIT 100")).rows;
  for (const row of rows) enqueueNotification({
    type: 'inbox-email',
    notificationId: row.id
  });
}
