-- Transaksi yang disembunyikan dari API POS (tindakan "Sembunyikan dari API POS" di dashboard).
-- Tetap tampil di dashboard dan tetap ikut pencocokan otomatis; hanya tidak dikirim ke
-- GET /api/v1/pos/transactions dan tidak bisa ditautkan lewat POST /api/v1/pos/orders/:id/match.
ALTER TABLE incoming_transactions ADD COLUMN pos_hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE incoming_transactions ADD COLUMN pos_hidden_at TIMESTAMPTZ;
CREATE INDEX incoming_transactions_pos_hidden_idx ON incoming_transactions (pos_hidden) WHERE pos_hidden;
