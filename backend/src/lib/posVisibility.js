// Visibilitas transaksi masuk di API POS. Transaksi tidak tampil bila:
//  - disembunyikan per transaksi (kolom incoming_transactions.pos_hidden), atau
//  - nama pengirimnya mengandung salah satu teks di pengaturan `pos_api.hidden_senders`.

export const HIDDEN_SENDERS_KEY = 'pos_api.hidden_senders';

/** Pola ILIKE "mengandung" untuk tiap aturan pengirim ('%', '_' dan '\' dianggap teks biasa). */
export const hiddenSenderPatterns = (names) => names.map((n) => `%${String(n).replace(/[\\%_]/g, '\\$&')}%`);

/** Aturan pengirim yang cocok dengan nama pengirim ini (tanpa beda huruf besar/kecil). */
export function matchingSenderRules(sender, names) {
  const s = String(sender ?? '').toLowerCase();
  if (!s) return [];
  return (names ?? []).filter((n) => s.includes(String(n).toLowerCase()));
}

export const isHiddenSender = (sender, names) => matchingSenderRules(sender, names).length > 0;

/** Tambahkan info visibilitas API POS ke baris transaksi dashboard. */
export function withPosVisibility(row, names) {
  const rules = matchingSenderRules(row.sender_name, names);
  return { ...row, pos_hidden: !!row.pos_hidden, pos_hidden_rules: rules, pos_visible: !row.pos_hidden && rules.length === 0 };
}

/**
 * Klausa SQL (tanpa WHERE) untuk alias tabel `t`.
 * mode 'visible' = tampil di API POS, 'hidden' = disembunyikan (manual atau aturan pengirim).
 */
export function posVisibilitySql(mode, names, addParam) {
  if (mode !== 'visible' && mode !== 'hidden') return null;
  const bySender = names.length ? `COALESCE(t.sender_name, '') ILIKE ANY(${addParam(hiddenSenderPatterns(names))}::text[])` : null;
  if (mode === 'visible') return bySender ? `(NOT t.pos_hidden AND NOT ${bySender})` : 'NOT t.pos_hidden';
  return bySender ? `(t.pos_hidden OR ${bySender})` : 't.pos_hidden';
}
