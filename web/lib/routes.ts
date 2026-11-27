// Alamat halaman detail. Dashboard di-build sebagai static export (disajikan backend di container yang sama),
// sehingga ID dikirim lewat query string, bukan segmen dinamis /[id].

const q = (id: string | number) => encodeURIComponent(String(id));

export const routes = {
  device: (id: string | number) => `/devices/detail?id=${q(id)}`,
  order: (id: string | number) => `/orders/detail?id=${q(id)}`,
  transaction: (id: string | number) => `/transactions/detail?id=${q(id)}`,
};
