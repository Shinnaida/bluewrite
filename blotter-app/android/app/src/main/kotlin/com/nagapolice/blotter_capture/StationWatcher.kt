package com.nagapolice.blotter_capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/// Opening the app by itself when the phone joins the station Wi-Fi.
///
/// WHY NATIVE. Dart cannot see a Wi-Fi change while the app is not running,
/// so the watch lives here: a small foreground service holds a
/// ConnectivityManager callback for Wi-Fi networks and, on every join,
/// knocks on the station server the app last found (the same
/// GET /api/v1/station handshake ServerDiscovery runs — a 401 counts, it
/// still means "this origin speaks BlueWrite"). When the server answers,
/// the app is brought to the front and the officer only types the PIN.
///
/// WHICH NETWORK. It does not match an SSID: reading one needs location
/// permission, and a station LAN often has several access points. The
/// server answering over Wi-Fi IS the test — a phone on the wrong network
/// simply gets no answer and nothing happens.
///
/// ANDROID'S RULES. Since Android 10 an app cannot start an activity from
/// the background without an exemption; holding the "display over other
/// apps" permission (SYSTEM_ALERT_WINDOW) is that exemption, and the
/// station install grants it. Where it is missing the same open is offered
/// as a high-importance notification with a full-screen intent, so the
/// phone still surfaces the app instead of failing silently.
object StationWatch {
  private const val TAG = "BlueWriteWatch"
  private const val PREFS = "bluewrite_watch"
  private const val KEY_URL = "base_url"

  private fun prefs(ctx: Context) =
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /// The address the app last reached, mirrored from Dart (see
  /// ServerDiscovery.rememberStation). Not a secret — the token stays in the
  /// keystore — so it can live in plain preferences the service can read
  /// while the app is closed.
  fun baseUrl(ctx: Context): String? =
      prefs(ctx).getString(KEY_URL, null)?.trim()?.takeIf { it.isNotEmpty() }

  fun remember(ctx: Context, url: String) {
    val clean = url.trim().trimEnd('/')
    if (clean.isEmpty()) return
    prefs(ctx).edit().putString(KEY_URL, clean).apply()
    start(ctx)
  }

  /// Start the watcher when a station address is known. Called from
  /// MainActivity (foreground, always allowed) and from boot/update
  /// receivers (an allowed background start).
  /// The "station server found" notification the app used to post on every
  /// open (removed in 0.1.6 — it was noise). Cancelled on launch so an
  /// upgrade clears whatever is already sitting in the shade.
  fun clearFoundNotification(ctx: Context) {
    try {
      (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
          .cancel(FOUND_NOTIFICATION_ID)
    } catch (_: Exception) {
    }
  }

  private const val FOUND_NOTIFICATION_ID = 8098

  fun start(ctx: Context) {
    if (baseUrl(ctx) == null) return
    val intent = Intent(ctx, StationWatcherService::class.java)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
    } catch (e: Exception) {
      // Android 12 refuses a foreground-service start from the background
      // outside its exemptions; the next app launch starts it instead.
      Log.w(TAG, "watcher not started: ${e.message}")
    }
  }
}

class StationWatcherService : Service() {
  private val tag = "BlueWriteWatch"
  private val io = Executors.newSingleThreadExecutor()
  private val cm: ConnectivityManager?
    get() = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

  private var callback: ConnectivityManager.NetworkCallback? = null

  /// The network this service already knocked on, and the one it already
  /// opened the app for: Android reports one join several times, so those
  /// repeats are collapsed — and a NEW join always gets its own open, even
  /// seconds after the last one.
  private var probedFor = Long.MIN_VALUE
  private var openedFor = Long.MIN_VALUE

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    channel(WATCH_CHANNEL, "Station network",
        NotificationManager.IMPORTANCE_LOW)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(WATCH_ID, watching())
    watch()
    return START_STICKY
  }

  override fun onDestroy() {
    callback?.let { cb ->
      try {
        cm?.unregisterNetworkCallback(cb)
      } catch (_: Exception) {
      }
    }
    callback = null
    io.shutdown()
    super.onDestroy()
  }

  /// One callback for the life of the service: every Wi-Fi this phone joins
  /// and every change to its capabilities. A station LAN without an
  /// internet uplink never reaches VALIDATED, so only the transport is
  /// required — the server answering is the real test.
  private fun watch() {
    if (callback != null) return
    val request = NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .build()
    val cb = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        Log.i(tag, "wi-fi joined: $network")
        knock(network)
      }

      override fun onCapabilitiesChanged(
          network: Network,
          caps: NetworkCapabilities,
      ) {
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) knock(network)
      }

      override fun onLost(network: Network) {
        Log.i(tag, "wi-fi left: $network")
        openedFor = Long.MIN_VALUE
      }
    }
    try {
      cm?.registerNetworkCallback(request, cb)
      callback = cb
    } catch (e: Exception) {
      Log.w(tag, "could not watch wi-fi: ${e.message}")
    }
  }

  /// One knock per join, however many callbacks that join produces.
  private fun knock(network: Network) {
    val handle = network.networkHandle
    if (probedFor == handle) return
    probedFor = handle
    io.execute { tryOpen(handle) }
  }

  /// The address and route often land a second or two AFTER the join, so a
  /// single knock can be too early. The first half-minute is retried instead
  /// of waiting for the next Wi-Fi change, and one join opens the app once.
  private fun tryOpen(handle: Long) {
    val base = StationWatch.baseUrl(this)
    if (base == null) {
      Log.i(tag, "no station address yet — open the app once")
      probedFor = Long.MIN_VALUE
      return
    }
    for (wait in RETRY_WAITS_MS) {
      if (wait > 0) Thread.sleep(wait)
      if (!reachable(base)) {
        Log.i(tag, "no answer yet from $base")
        continue
      }
      Log.i(tag, "station answered at $base")
      if (openedFor == handle) {
        Log.i(tag, "already open for this join")
      } else {
        openedFor = handle
        openApp()
      }
      return
    }
    Log.i(tag, "no answer from $base — staying quiet")
  }

  /// The portal's own handshake, in the app's voice: 200 or 401 with a JSON
  /// body, never a hotspot login page or a router's admin screen.
  private fun reachable(baseUrl: String): Boolean {
    val base = baseUrl.trimEnd('/')
    var conn: HttpURLConnection? = null
    return try {
      conn = URL("$base/api/v1/station").openConnection() as HttpURLConnection
      conn.connectTimeout = PROBE_TIMEOUT_MS
      conn.readTimeout = PROBE_TIMEOUT_MS
      conn.requestMethod = "GET"
      conn.instanceFollowRedirects = false
      conn.setRequestProperty("Accept", "application/json")
      val code = conn.responseCode
      val type = (conn.contentType ?: "").lowercase()
      (code == 200 || code == 401) && type.contains("json")
    } catch (e: Exception) {
      false
    } finally {
      conn?.disconnect()
    }
  }

  private fun openApp() {
    val open = Intent(this, MainActivity::class.java).apply {
      addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK or
              Intent.FLAG_ACTIVITY_SINGLE_TOP or
              Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    }
    // No notification: the app opens directly. The "station server found"
    // note this used to post was pure noise on a phone that already has the
    // overlay exemption (owner report, 2026-11-17).
    try {
      startActivity(open)
      Log.i(tag, "station answered — opened the app")
    } catch (e: Exception) {
      Log.w(tag, "could not open the app: ${e.message}")
    }
  }

  private fun watching(): Notification {
    val open = PendingIntent.getActivity(
        this, WATCH_ID,
        Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return builder(WATCH_CHANNEL)
        .setSmallIcon(android.R.drawable.stat_notify_sync)
        .setContentTitle("BlueWrite is watching for the station Wi-Fi")
        .setContentText("It opens by itself when the station server answers.")
        .setContentIntent(open)
        .setOngoing(true)
        .build()
  }

  /// The app's minSdk is 24 and channels are 26+: the two-argument builder
  /// exists only where channels do.
  private fun builder(channelId: String): Notification.Builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, channelId)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(this)
      }

  private fun channel(id: String, name: String, importance: Int) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        manager.getNotificationChannel(id) == null) {
      manager.createNotificationChannel(NotificationChannel(id, name, importance))
    }
  }

  companion object {
    private const val WATCH_CHANNEL = "bluewrite_watch"
    private const val WATCH_ID = 8099
    private const val PROBE_TIMEOUT_MS = 3000

    /// Knock on arrival, then again as DHCP and the route settle (0, 3, 9
    /// and 21 seconds in).
    private val RETRY_WAITS_MS = longArrayOf(0, 3000, 6000, 12000)
  }
}

/// Bring the watcher back after a reboot or an update — the phone should not
/// need the app opened by hand once for the watch to exist.
class StationBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    StationWatch.start(context)
  }
}
