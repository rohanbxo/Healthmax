/**
 * OpenAPI for the push endpoints (SPEC.md §9). Imported for its side effect
 * by `routes.ts`.
 */
import { z } from 'zod';
import { pushSubscriptionBodySchema, pushUnsubscribeBodySchema } from '@beta/core';

import { apiRegistry } from '../../http/openapi';
import { UNAUTHENTICATED_RESPONSE, errorResponse, security } from '../habits/openapi';

const vapidKeySchema = z.object({ publicKey: z.string() });

const deliveryReportSchema = z.object({
  sent: z.number().int().min(0),
  removed: z.number().int().min(0),
  failed: z.number().int().min(0),
});

apiRegistry.registerPath({
  method: 'get',
  path: '/api/push/vapid-public-key',
  summary: 'The VAPID public key',
  description:
    'Public by design: the browser encrypts to it when it subscribes. `404` while push is not configured on the ' +
    'server, which the web app reads as "push unavailable".',
  tags: ['push'],
  responses: {
    200: {
      description: 'The application server key.',
      content: { 'application/json': { schema: vapidKeySchema } },
    },
    404: errorResponse('Push notifications are not configured.'),
  },
});

apiRegistry.registerPath({
  method: 'post',
  path: '/api/push/subscriptions',
  summary: 'Register this browser for reminders',
  description:
    'Upsert by endpoint: re-subscribing the same browser updates its keys and clears its failure count, and moves ' +
    'the subscription to the caller if the device was previously someone else’s.',
  tags: ['push'],
  security,
  request: {
    body: { content: { 'application/json': { schema: pushSubscriptionBodySchema } } },
  },
  responses: {
    204: { description: 'Registered.' },
    400: errorResponse('The subscription is malformed.'),
    401: UNAUTHENTICATED_RESPONSE,
  },
});

apiRegistry.registerPath({
  method: 'delete',
  path: '/api/push/subscriptions',
  summary: 'Unregister this browser',
  description:
    'Idempotent, and scoped to the caller: an endpoint that is not theirs is left alone.',
  tags: ['push'],
  security,
  request: {
    body: { content: { 'application/json': { schema: pushUnsubscribeBodySchema } } },
  },
  responses: {
    204: { description: 'Unregistered, or there was nothing to remove.' },
    400: errorResponse('The endpoint is malformed.'),
    401: UNAUTHENTICATED_RESPONSE,
  },
});

apiRegistry.registerPath({
  method: 'post',
  path: '/api/push/test',
  summary: 'Send a test notification',
  description:
    'Sends one notification to every device the caller has registered, and prunes the ones the push service ' +
    'reports as gone.',
  tags: ['push'],
  security,
  responses: {
    200: {
      description: 'How many were sent, removed as dead, and failed.',
      content: { 'application/json': { schema: deliveryReportSchema } },
    },
    401: UNAUTHENTICATED_RESPONSE,
  },
});
