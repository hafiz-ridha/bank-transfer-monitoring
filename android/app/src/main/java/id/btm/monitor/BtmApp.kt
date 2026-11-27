package id.btm.monitor

import android.app.Application
import android.content.Context

class BtmApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.onAppCreate()
    }
}

/** Akses container dari Activity, Service, BroadcastReceiver, dan Worker. */
val Context.appContainer: AppContainer
    get() = (applicationContext as BtmApp).container
