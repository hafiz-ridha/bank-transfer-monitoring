'use client';
// Visibilitas transaksi masuk di API POS: badge + dialog "Sembunyikan / Tampilkan di API POS".
import { useState } from 'react';
import { Badge, Callout, ConfirmModal } from '@/components/ui';
import { api } from '@/lib/api';
import type { PosVisibilityResult, Transaction } from '@/lib/types';

type PosVis = Pick<Transaction, 'pos_hidden' | 'pos_hidden_rules' | 'pos_visible'>;

const rulesText = (rules: string[]) => rules.map((r) => `“${r}”`).join(', ');

export function PosVisibilityBadge({ t, sm }: { t: PosVis; sm?: boolean }) {
  if (t.pos_visible) return <Badge tone="green" sm={sm} dot>Tampil</Badge>;
  if (t.pos_hidden) return <Badge tone="gray" sm={sm} title="Disembunyikan manual dari API POS">Disembunyikan</Badge>;
  return <Badge tone="gray" sm={sm} title={`Aturan nama pengirim: ${rulesText(t.pos_hidden_rules)}`}>Disembunyikan · aturan pengirim</Badge>;
}

/** Pesan hasil untuk toast setelah visibilitas diubah. */
export function posVisibilityMessage(r: PosVisibilityResult): { ok: boolean; msg: string } {
  if (r.pos_visible) return { ok: true, msg: `${r.transaction_code} tampil lagi di API POS` };
  if (!r.pos_hidden && r.pos_hidden_rules.length) {
    return { ok: false, msg: `${r.transaction_code} masih disembunyikan oleh aturan nama pengirim ${rulesText(r.pos_hidden_rules)}. Admin dapat menghapusnya di Pengaturan → API POS.` };
  }
  return { ok: true, msg: `${r.transaction_code} disembunyikan dari API POS` };
}

export function PosVisibilityModal({ t, isAdmin, onClose, onDone }: {
  t: Pick<Transaction, 'id' | 'transaction_code' | 'sender_name'> & PosVis;
  isAdmin: boolean;
  onClose: () => void;
  onDone: (r: PosVisibilityResult) => Promise<void>;
}) {
  // Menyembunyikan bila saat ini tampil; selain itu menampilkan lagi.
  const hide = t.pos_visible;
  const sender = t.sender_name?.trim() || null;
  const byRule = t.pos_hidden_rules.length > 0;
  const [senderRule, setSenderRule] = useState(!hide && byRule && isAdmin);

  return (
    <ConfirmModal
      title={hide ? 'Sembunyikan dari API POS' : 'Tampilkan lagi di API POS'}
      tone={hide ? 'danger' : 'primary'}
      confirmLabel={hide ? 'Sembunyikan' : 'Tampilkan'}
      description={hide ? (
        <>Transaksi <b>{t.transaction_code}</b> tidak akan muncul di daftar transaksi API POS dan tidak bisa ditautkan dari POS.
          Transaksi tetap tampil di dashboard dan tetap ikut pencocokan otomatis.</>
      ) : (
        <>Transaksi <b>{t.transaction_code}</b> akan muncul lagi di daftar transaksi API POS.</>
      )}
      notePlaceholder={hide ? 'Mis. transfer pribadi / bukan penjualan' : undefined}
      onClose={onClose}
      onConfirm={async (note) => {
        const r = await api.post<PosVisibilityResult>(`/transactions/${t.id}/pos-visibility`, {
          hidden: hide, note, ...(senderRule ? { sender_rule: true } : {}),
        });
        await onDone(r);
      }}
    >
      {!hide && byRule && !isAdmin && (
        <Callout kind="warn">
          Transaksi ini juga disembunyikan oleh aturan nama pengirim {rulesText(t.pos_hidden_rules)} sehingga tetap tidak tampil.
          Minta admin menghapus aturan tersebut.
        </Callout>
      )}
      {isAdmin && sender && (hide || byRule) && (
        <label className="checkbox">
          <input type="checkbox" checked={senderRule} onChange={(e) => setSenderRule(e.target.checked)} />
          {hide ? (
            <span>Sembunyikan juga <b>semua</b> transaksi dari pengirim “{sender}” (disimpan di Pengaturan → API POS)</span>
          ) : (
            <span>Hapus aturan nama pengirim {rulesText(t.pos_hidden_rules)} (berlaku untuk semua transaksinya)</span>
          )}
        </label>
      )}
    </ConfirmModal>
  );
}
