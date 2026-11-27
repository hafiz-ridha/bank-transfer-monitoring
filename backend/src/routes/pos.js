// POS API Integration (PRD §7)
export default async function posRoutes(app) {
  const { orders } = app.services;
  const auth = { preHandler: app.requirePos };

  app.post('/orders', {
    ...auth,
    schema: {
      body: {
        type: 'object',
        required: ['order_id', 'amount', 'created_at'],
        additionalProperties: false,
        properties: {
          order_id: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9._:\\-/]+$' },
          customer_name: { type: ['string', 'null'], maxLength: 200 },
          amount: { type: 'integer', minimum: 1, maximum: 9999999999999 },
          payment_method: { type: 'string', maxLength: 40 },
          destination_account: { type: ['string', 'null'], maxLength: 60 },
          created_at: { type: 'string', format: 'date-time' },
          expires_at: { type: ['string', 'null'], format: 'date-time' },
          metadata: { type: ['object', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const { order, created } = await orders.create(req.apiClient, req.body, req);
    const payment = await orders.payment(order.order_id);
    return reply.status(created ? 201 : 200).send({ created, order: payment });
  });

  app.get('/orders/:order_id/payment', auth, async (req) => orders.payment(req.params.order_id));

  app.post('/orders/:order_id/cancel', auth, async (req) => orders.cancel(req.apiClient, req.params.order_id, req));
}
