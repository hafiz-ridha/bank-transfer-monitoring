'use client';
import { useState } from 'react';
import { AddDeviceModal, DeviceTable } from '@/components/devices';
import { DeviceStatusBadge } from '@/components/status';
import { Card, DataState, PageHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import type { Device, DeviceStatus, ListResponse } from '@/lib/types';

const LEGEND: { status: DeviceStatus; text: string }[] = [
  { status: 'ACTIVE', text: 'heartbeat terbaru & listener terhubung' },
  { status: 'WARNING', text: 'heartbeat terlambat / kendala konfigurasi' },
  { status: 'INACTIVE', text: 'heartbeat hilang melewati ambang' },
  { status: 'PERMISSION_ERROR', text: 'Notification Access nonaktif' },
  { status: 'DISCONNECTED', text: 'perangkat melaporkan koneksi terputus' },
  { status: 'UNKNOWN', text: 'belum ada data cukup' },
];

export default function DevicesPage() {
  const { isAdmin } = useAuth();
  const state = useApi<ListResponse<Device>>('/devices', undefined, { poll: true });
  const [adding, setAdding] = useState(false);
  const devices = state.data?.data ?? [];
  const counts = devices.reduce<Record<string, number>>((acc, d) => {
    acc[d.status] = (acc[d.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Monitoring perangkat"
        subtitle="Status aplikasi Android Monitoring tanpa perlu membuka HP. Status dihitung server dari heartbeat & laporan perangkat."
        updatedAt={state.updatedAt}
        onRefresh={() => void state.reload()}
        live
        actions={isAdmin && <button type="button" className="btn primary" onClick={() => setAdding(true)}>+ Tambah perangkat</button>}
      />
      <Card flush
        title={`${devices.length} perangkat`}
        hint={Object.entries(counts).map(([k, v]) => `${k.replace('_', ' ')}: ${v}`).join(' · ') || undefined}
      >
        <DataState state={state}>
          {(d) => <DeviceTable devices={d.data} isAdmin={isAdmin} onChanged={() => void state.reload()} />}
        </DataState>
      </Card>
      <div className="card mt-3">
        <div className="card-body">
          <div className="label mb-1">Keterangan warna status</div>
          <div className="row" style={{ gap: 14 }}>
            {LEGEND.map((l) => (
              <span key={l.status} className="row small" style={{ gap: 6 }}><DeviceStatusBadge status={l.status} /> <span className="muted">{l.text}</span></span>
            ))}
          </div>
          <div className="small muted mt-2">
            <b>Dilaporkan perangkat</b> = kondisi dikirim eksplisit oleh HP (heartbeat/event). <b>Dugaan: heartbeat hilang</b> = server tidak menerima heartbeat melewati ambang batas, sehingga status disimpulkan (HP mungkin mati, tanpa internet, atau aplikasi dihentikan sistem).
          </div>
        </div>
      </div>
      {adding && <AddDeviceModal onClose={() => setAdding(false)} onCreated={() => void state.reload()} />}
    </>
  );
}
