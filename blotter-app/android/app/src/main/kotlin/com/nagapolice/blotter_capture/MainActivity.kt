package com.nagapolice.blotter_capture

import android.content.Context
import android.net.ConnectivityManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.net.Inet4Address

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bluewrite/network")
            .setMethodCallHandler { call, result ->
                if (call.method == "ipv4Prefixes") {
                    result.success(ipv4Prefixes())
                } else {
                    result.notImplemented()
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
