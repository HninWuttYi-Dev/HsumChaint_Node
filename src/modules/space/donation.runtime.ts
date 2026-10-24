import { sendPush } from '@/lib/firebase';
import { prisma } from '@/lib/prisma';
import { logger } from '@/utils/logger';
import { createDonationService } from './donation.service';

export const donationService = createDonationService(prisma, {
  sendPush: (token, message, data) => sendPush(token, message, data, 'Donation Update'),
  onPushError: (error) =>
    logger.error({ error }, 'Donation push failed; in-app notification retained'),
});
