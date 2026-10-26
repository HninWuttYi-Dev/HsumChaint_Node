import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export async function sendPush(
  token: string,
  message: string,
  data: Record<string, string>,
  title = 'Donation reminder'
) {
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault() });
  await getMessaging(app).send({
    token,
    notification: { title, body: message },
    data,
  });
}
