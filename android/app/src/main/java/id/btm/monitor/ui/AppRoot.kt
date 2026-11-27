package id.btm.monitor.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountBox
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import id.btm.monitor.ui.screens.BankSourcesScreen
import id.btm.monitor.ui.screens.BatteryGuideScreen
import id.btm.monitor.ui.screens.DashboardScreen
import id.btm.monitor.ui.screens.HistoryScreen
import id.btm.monitor.ui.screens.OnboardingScreen
import id.btm.monitor.ui.screens.QueueScreen
import id.btm.monitor.ui.screens.SettingsScreen
import id.btm.monitor.ui.screens.StatusScreen
import kotlinx.coroutines.launch

/** Menu utama sesuai PRD §3.9 (+ layar panduan baterai sebagai sub-halaman). */
enum class Screen(val title: String, val inDrawer: Boolean = true) {
    DASHBOARD("Dashboard"),
    SOURCES("Sumber Bank"),
    HISTORY("Histori Deteksi"),
    QUEUE("Antrean Sinkronisasi"),
    STATUS("Status Monitoring"),
    SETTINGS("Pengaturan"),
    BATTERY("Panduan Baterai", inDrawer = false),
}

private fun Screen.icon(): ImageVector = when (this) {
    Screen.DASHBOARD -> Icons.Filled.Home
    Screen.SOURCES -> Icons.Filled.AccountBox
    Screen.HISTORY -> Icons.Filled.DateRange
    Screen.QUEUE -> Icons.Filled.Refresh
    Screen.STATUS -> Icons.Filled.CheckCircle
    Screen.SETTINGS -> Icons.Filled.Settings
    Screen.BATTERY -> Icons.Filled.Settings
}

@Composable
fun AppRoot(vm: MainViewModel = viewModel()) {
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val repairMode by vm.repairMode.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        val m = message
        if (m != null) {
            // Tampilkan dulu, baru dikonsumsi: mengubah key lebih awal akan membatalkan snackbar ini.
            snackbar.showSnackbar(m)
            vm.consumeMessage()
        }
    }

    if (!prefs.registered || prefs.needsRepair || repairMode) {
        OnboardingScreen(vm = vm, prefs = prefs, repairMode = repairMode, snackbar = snackbar)
    } else {
        MainScaffold(vm, snackbar)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainScaffold(vm: MainViewModel, snackbar: SnackbarHostState) {
    var screen by rememberSaveable { mutableStateOf(Screen.DASHBOARD) }
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    BackHandler(enabled = drawerState.isOpen || screen != Screen.DASHBOARD) {
        if (drawerState.isOpen) {
            scope.launch { drawerState.close() }
        } else if (screen == Screen.BATTERY) {
            screen = Screen.STATUS
        } else {
            screen = Screen.DASHBOARD
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
                Text(
                    "Bank Transfer Monitor",
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 20.dp),
                    style = MaterialTheme.typography.titleLarge,
                )
                HorizontalDivider()
                Screen.entries.filter { it.inDrawer }.forEach { item ->
                    NavigationDrawerItem(
                        label = { Text(item.title) },
                        icon = { Icon(item.icon(), contentDescription = null) },
                        selected = item == screen,
                        onClick = {
                            screen = item
                            scope.launch { drawerState.close() }
                        },
                        modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
                    )
                }
            }
        },
    ) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(screen.title) },
                    navigationIcon = {
                        if (screen == Screen.BATTERY) {
                            IconButton(onClick = { screen = Screen.STATUS }) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Kembali")
                            }
                        } else {
                            IconButton(onClick = { scope.launch { drawerState.open() } }) {
                                Icon(Icons.Filled.Menu, contentDescription = "Menu")
                            }
                        }
                    },
                )
            },
            snackbarHost = { SnackbarHost(snackbar) },
        ) { padding ->
            Box(
                Modifier
                    .padding(padding)
                    .fillMaxSize(),
            ) {
                val navigate: (Screen) -> Unit = { screen = it }
                when (screen) {
                    Screen.DASHBOARD -> DashboardScreen(vm, navigate)
                    Screen.SOURCES -> BankSourcesScreen(vm)
                    Screen.HISTORY -> HistoryScreen(vm)
                    Screen.QUEUE -> QueueScreen(vm)
                    Screen.STATUS -> StatusScreen(vm, navigate)
                    Screen.SETTINGS -> SettingsScreen(vm)
                    Screen.BATTERY -> BatteryGuideScreen(vm)
                }
            }
        }
    }
}
