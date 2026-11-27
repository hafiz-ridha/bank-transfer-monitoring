package id.btm.monitor

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import id.btm.monitor.ui.AppRoot
import id.btm.monitor.ui.theme.BtmTheme

/**
 * Satu-satunya Activity. Monitoring TIDAK bergantung pada Activity ini (PRD §3.2); Activity hanya
 * menampilkan status dan memicu rekonsiliasi saat dibuka kembali (PRD §3.3).
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) appContainer.onAppOpened()
        setContent {
            BtmTheme {
                AppRoot()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        appContainer.reconcileOnResume()
    }
}
