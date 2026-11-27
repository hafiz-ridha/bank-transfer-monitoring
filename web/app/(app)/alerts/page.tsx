'use client';
import { useState } from 'react';
import { AlertList } from '@/components/alerts';
import { Card, DataState, PageHeader, Tabs } from '@/components/ui';
import { useApi } from '@/lib/hooks';
import type { Alert, ListResponse } from '@/lib/types';

type TabKey = 'active' | 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export default function AlertsPage() {
  const [tab, setTab] = useState<TabKey>('active');
  const active = useApi<ListResponse<Alert>>('/alerts', { status: 'active', limit: 500 }, { poll: true });
  const resolved = useApi<ListResponse<Alert>>('/alerts', { status: 'RESOLVED', limit: 200 }, { poll: tab === 'RESOLVED' });

  const all = active.data?.data ?? [];
  const open = all.filter((a) => a.status === 'OPEN');
  const acked = all.filter((a) => a.status === 'ACKNOWLEDGED');
  const shown = tab === 'active' ? all : tab === 'OPEN' ? open : tab === 'ACKNOWLEDGED' ? acked : resolved.data?.data ?? [];
  const current = tab === 'RESOLVED' ? resolved : active;

  return (
    <>
      <PageHeader
        title="Alert perangkat"
        subtitle="Peringatan otomatis: heartbeat hilang > ambang, Notification Access dinonaktifkan, listener terputus, antrean menumpuk, sinkronisasi gagal, versi aplikasi tidak didukung."
        updatedAt={current.updatedAt}
        onRefresh={() => { void active.reload(); void resolved.reload(); }}
        live
      />
      <Card flush>
        <Tabs<TabKey>
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'active', label: 'Aktif', count: all.length },
            { key: 'OPEN', label: 'Terbuka', count: open.length },
            { key: 'ACKNOWLEDGED', label: 'Sudah diketahui', count: acked.length },
            { key: 'RESOLVED', label: 'Selesai', count: resolved.data?.data.length ?? null },
          ]}
        />
        <DataState state={current}>
          {() => (
            <AlertList
              alerts={shown}
              onChanged={() => void active.reload()}
              emptyText={tab === 'RESOLVED' ? 'Belum ada alert yang selesai.' : 'Tidak ada alert pada kategori ini.'}
            />
          )}
        </DataState>
      </Card>
      <div className="small muted mt-2">
        Alert tertutup otomatis (Selesai) saat kondisi perangkat pulih. “Tandai diketahui” hanya menandakan alert sudah ditangani petugas; alert tetap aktif sampai kondisi normal.
      </div>
    </>
  );
}
