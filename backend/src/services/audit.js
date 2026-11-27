// Audit log: semua tindakan admin/operator, perangkat, dan POS yang mengubah data penting.
export async function audit(db, entry) {
  const {
    actor, action, entityType = null, entityId = null, before = null, after = null, note = null, req = null,
  } = entry;
  await db.query(
    `INSERT INTO audit_logs (actor_type, actor_id, actor_label, action, entity_type, entity_id, before, after, note, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`,
    [
      actor?.type ?? 'system',
      actor?.id ?? null,
      actor?.label ?? null,
      action,
      entityType,
      entityId == null ? null : String(entityId),
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
      note,
      req?.ip ?? null,
      req?.headers?.['user-agent']?.slice(0, 300) ?? null,
    ],
  );
}

export const userActor = (user) => ({ type: 'user', id: user.id, label: user.email });
export const deviceActor = (device) => ({ type: 'device', id: device.id, label: device.device_name });
export const posActor = (client) => ({ type: 'pos', id: client?.id ?? null, label: client?.name ?? 'POS' });
export const systemActor = { type: 'system', id: null, label: 'system' };
