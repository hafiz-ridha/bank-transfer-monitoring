# ---------------------------------------------------------------------------
# kotlinx.serialization
# (library juga membawa consumer rules sendiri; aturan di bawah sebagai pengaman)
# ---------------------------------------------------------------------------
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-dontnote kotlinx.serialization.SerializationKt

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# DTO aplikasi (@Serializable)
-keep,includedescriptorclasses class id.btm.monitor.**$$serializer { *; }
-keepclassmembers class id.btm.monitor.** {
    *** Companion;
}
-keepclasseswithmembers class id.btm.monitor.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# ---------------------------------------------------------------------------
# OkHttp (aturan resmi sudah dibawa library; ini hanya menekan peringatan opsional)
# ---------------------------------------------------------------------------
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# Room & WorkManager membawa consumer rules sendiri.
# Service/receiver/worker yang dideklarasikan di manifest otomatis dipertahankan oleh AAPT.
