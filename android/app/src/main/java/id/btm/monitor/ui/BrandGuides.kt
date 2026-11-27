package id.btm.monitor.ui

/** Panduan pengaturan baterai/background per merek (PRD §3.4). Nama menu dapat berbeda per versi ROM. */
data class BrandGuide(val brand: String, val hasAutostart: Boolean, val steps: List<String>)

object BrandGuides {
    private const val APP = "BTM Monitor"

    fun forManufacturer(manufacturer: String): BrandGuide {
        val m = manufacturer.lowercase()
        return when {
            m.contains("samsung") -> BrandGuide(
                "Samsung (One UI)", false,
                listOf(
                    "Pengaturan > Aplikasi > $APP > Baterai > pilih \"Tidak dibatasi\" (Unrestricted).",
                    "Pengaturan > Perawatan perangkat/Baterai > Batas penggunaan latar belakang: pastikan $APP TIDAK ada di \"Aplikasi tidur\" / \"Aplikasi tidur nyenyak\", lalu tambahkan ke \"Aplikasi tidak pernah tidur\".",
                    "Matikan \"Tidurkan aplikasi yang tidak digunakan\" (Put unused apps to sleep) bila tersedia.",
                    "Pastikan notifikasi aplikasi bank aktif dan tidak dibisukan.",
                    "Jangan gunakan \"Tutup semua\" pada layar aplikasi terbaru untuk $APP.",
                ),
            )
            m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") -> BrandGuide(
                "Xiaomi / Redmi / POCO (MIUI / HyperOS)", true,
                listOf(
                    "Aplikasi Keamanan > Izin > Mulai otomatis (Autostart): aktifkan untuk $APP.",
                    "Pengaturan > Aplikasi > Kelola aplikasi > $APP > Penghemat baterai: pilih \"Tidak ada batasan\".",
                    "Buka layar aplikasi terbaru, tekan lama kartu $APP, lalu pilih ikon gembok (kunci aplikasi).",
                    "Pengaturan > Aplikasi > Kelola aplikasi > $APP > Izin lainnya: izinkan \"Tampilkan di layar kunci\" bila diminta.",
                    "Pastikan notifikasi aplikasi bank aktif (Pengaturan > Notifikasi).",
                ),
            )
            m.contains("oppo") -> BrandGuide(
                "OPPO (ColorOS)", true,
                listOf(
                    "Pengaturan > Baterai > Pengelolaan baterai aplikasi > $APP: izinkan aktivitas latar belakang dan \"Izinkan peluncuran otomatis\".",
                    "Pengaturan > Aplikasi > Peluncuran otomatis (Auto launch): aktifkan $APP.",
                    "Kunci $APP di layar aplikasi terbaru (tarik kartu ke bawah / ikon gembok).",
                    "Matikan \"Optimalkan penggunaan baterai\" untuk $APP bila tersedia.",
                ),
            )
            m.contains("vivo") || m.contains("iqoo") -> BrandGuide(
                "vivo / iQOO (Funtouch OS / OriginOS)", true,
                listOf(
                    "i Manager > Pengelola aplikasi > Pengelola mulai otomatis: aktifkan $APP.",
                    "Pengaturan > Baterai > Konsumsi daya latar belakang tinggi: izinkan $APP.",
                    "Kunci $APP di layar aplikasi terbaru.",
                    "Pastikan notifikasi aplikasi bank tidak dibatasi.",
                ),
            )
            m.contains("realme") -> BrandGuide(
                "realme (realme UI)", true,
                listOf(
                    "Pengaturan > Baterai > Pengelolaan baterai aplikasi > $APP: aktifkan \"Izinkan aktivitas latar belakang\", \"Izinkan peluncuran otomatis\".",
                    "Pengaturan > Aplikasi > Peluncuran otomatis: aktifkan $APP.",
                    "Kunci $APP di layar aplikasi terbaru.",
                ),
            )
            else -> BrandGuide(
                "Merek lain (${manufacturer.ifBlank { "tidak diketahui" }})", false,
                listOf(
                    "Pengaturan > Aplikasi > $APP > Baterai: pilih \"Tidak dibatasi\" / \"Tidak dioptimalkan\".",
                    "Nonaktifkan pembatasan latar belakang untuk $APP bila ada.",
                    "Jika ponsel memiliki menu \"Autostart\" / \"Mulai otomatis\", aktifkan untuk $APP.",
                    "Referensi per merek: dontkillmyapp.com",
                ),
            )
        }
    }
}
