package com.nagapolice.blotter_capture

import android.content.Context
import android.net.ConnectivityManager
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.net.Inet4Address

class MainActivity : FlutterActivity() {
    // The Wi-Fi watch survives this screen: started here so it exists the
    // moment the officer has used the app once (see StationWatcher.kt).
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        StationWatch.start(this)
        // Clear the "station server found" note older builds left behind.
        StationWatch.clearFoundNotification(this)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bluewrite/network")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "ipv4Prefixes" -> result.success(ipv4Prefixes())
                    // The address discovery settled on, mirrored so the watch
                    // can knock on it while this app is closed.
                    "saveStation" -> {
                        val url = call.argument<String>("url")
                        if (url.isNullOrBlank()) {
                            result.success(false)
                        } else {
                            StationWatch.remember(this, url)
                            result.success(true)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    // IPv4 address -> prefix length for every network this phone holds.
    // Modern Android denies /proc/net/route to apps, so Dart cannot read the
    // netmask from the kernel; LinkProperties is the same data Wi-Fi settings
    // shows (e.g. 192.168.64.81/21 on the station's /21 Wi-Fi).
    private fun ipv4Prefixes(): Map<String, Int> {
        val out = mutableMapOf<String, Int>()
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        for (network in cm.allNetworks) {
            val props = cm.getLinkProperties(network) ?: continue
            for (link in props.linkAddresses) {
                val address = link.address
                if (address is Inet4Address && !address.isLoopbackAddress) {
                    out[address.hostAddress ?: continue] = link.prefixLength
                }
            }
        }
        return out
    }
}
