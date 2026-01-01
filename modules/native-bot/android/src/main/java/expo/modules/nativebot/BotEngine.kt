package expo.modules.nativebot

import android.content.Context
import okhttp3.*
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

object BotEngine {
  private const val MAX_K_STEP = 100
  private val httpClient = OkHttpClient.Builder().build()
  private val scheduler = Executors.newScheduledThreadPool(4)
  private val timers = mutableListOf<ScheduledFuture<*>>()

  private var context: Context? = null
  private var running = false

  private var tokenApi: String = ""
  private var deviceId: String = ""
  private var apiUrl: String = "https://api.stockity.id"
  private var resumeState: JSONObject? = null

  private var config = JSONObject()

  private var tradeSocket: WebSocket? = null
  private var streamSocket: WebSocket? = null

  private var tradeReady = false
  private var streamReady = false
  private var tradeConnected = false
  private var streamConnected = false

  private var nextRef = 1
  private val joinRefs = ConcurrentHashMap<String, Int>()

  private val pendingUUIDs = mutableSetOf<String>()
  private val openedBids = mutableListOf<OpenedBid>()
  private val processedBatches = mutableSetOf<String>()

  private var martingaleStep = 0
  private var lossStreak = 0
  private var repeatStep = 0
  private var lastSignalTrend: String? = null
  private var lastFastBidTrend: String? = null
  private var fastRepeatTrend: String? = null
  private var momentumNoSignalSince: Long? = null
  private var totalProfit = 0.0

  private var forceDemo = false
  private var currentWalletType = "demo"
  private var allowAutoSwitch = true

  private var cooldownActive = false
  private var cooldownCount = 0
  private var cooldownMax = 5
  private var bidInFlightUntil = 0L
  private var flashInitialSent = false
  private var fastInitialSent = false
  private var fastCandleLogScheduled = false
  private var switchDemoActive = false
  private var switchDemoStep: Int? = null
  private var switchDemoReturnWallet: String? = null
  private var disableRepeatAfterDemo = false
  private var skipStopLossOnce = false
  private var profitReal = 0.0
  private var profitDemo = 0.0
  private var lastBidAt = 0L

  private data class OpenedBid(
    val assetRic: String,
    val closeAt: String,
    val openRate: Double,
    val trend: String,
    val uuid: String?,
    val amount: Double?,
    val payment: Double?,
    val dealType: String
  )

  fun start(appContext: Context, payload: String) {
    context = appContext
    if (running) return
    running = true
    parsePayload(payload)
    flashInitialSent = false
    fastInitialSent = false
    fastCandleLogScheduled = false
    fastRepeatTrend = null
    switchDemoActive = false
    switchDemoStep = null
    disableRepeatAfterDemo = false
    profitReal = 0.0
    profitDemo = 0.0
    allowAutoSwitch = true
    lastBidAt = 0L
    applyResumeState()
    currentWalletType = config.optString("walletType", "demo").lowercase()
    emitStatus("starting", "Menyiapkan bot...")
    connectSockets()
    scheduler.execute { refreshProfitFromApi("start") }
    scheduleStrategy()
    maybeStartFlashInitialBid()
  }

  fun stop() {
    running = false
    timers.forEach { it.cancel(true) }
    timers.clear()
    tradeSocket?.close(1000, "stop")
    streamSocket?.close(1000, "stop")
    tradeSocket = null
    streamSocket = null
    tradeReady = false
    streamReady = false
    tradeConnected = false
    streamConnected = false
    emitStatus("stopped", "Bot dihentikan")
  }

  fun updateConfig(payload: String) {
    parsePayload(payload)
    emitLog("Config updated")
  }

  private fun parsePayload(payload: String) {
    val obj = JSONObject(payload)
    val cfg = obj.optJSONObject("config") ?: JSONObject()
    config = cfg
    val auth = obj.optJSONObject("auth") ?: JSONObject()
    tokenApi = auth.optString("tokenApi", tokenApi)
    deviceId = auth.optString("deviceId", deviceId)
    apiUrl = auth.optString("apiUrl", apiUrl)
    resumeState = obj.optJSONObject("resumeState")
  }

  private fun connectSockets() {
    emitLog("Connecting WS...")
    val headers = mapOf(
      "Authorization-Token" to tokenApi,
      "Device-Id" to deviceId,
      "Device-Type" to "web",
      "Origin" to "https://stockity.id",
      "User-Agent" to "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      "Cookie" to "device_type=web; device_id=$deviceId; authtoken=$tokenApi"
    )

    tradeSocket = createSocket("wss://as.stockity.id/", headers, false)
    streamSocket = createSocket("wss://ws.stockity.id/?v=2&vsn=2.0.0", headers, true)

    scheduleHeartbeat()
    emitStatus("running", "Bot berjalan")
  }

  private fun createSocket(url: String, headers: Map<String, String>, includeRefs: Boolean): WebSocket {
    val builder = Request.Builder().url(url)
    headers.forEach { (k, v) -> builder.addHeader(k, v) }
    val request = builder.build()
    return httpClient.newWebSocket(
      request,
      object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          emitLog("WS connected: $url")
          if (includeRefs) streamConnected = true else tradeConnected = true
          emitWsStatus()
          joinTopics(webSocket, includeRefs)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
          handleSocketEvent(text)
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
          handleSocketEvent(bytes.utf8())
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
          emitError("WS error: ${t.message ?: "unknown"}")
          if (includeRefs) {
            streamConnected = false
            streamReady = false
          } else {
            tradeConnected = false
            tradeReady = false
          }
          emitWsStatus()
          if (running) {
            scheduler.schedule({ reconnect() }, 2, TimeUnit.SECONDS)
          }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          emitError("WS closed ($code): $reason")
          if (includeRefs) {
            streamConnected = false
            streamReady = false
          } else {
            tradeConnected = false
            tradeReady = false
          }
          emitWsStatus()
          if (running) {
            scheduler.schedule({ reconnect() }, 2, TimeUnit.SECONDS)
          }
        }
      }
    )
  }

  private fun reconnect() {
    if (!running) return
    tradeSocket?.close(1000, "reconnect")
    streamSocket?.close(1000, "reconnect")
    tradeSocket = null
    streamSocket = null
    tradeReady = false
    streamReady = false
    connectSockets()
  }

  private fun joinTopics(socket: WebSocket, includeRefs: Boolean) {
    val asset = config.optString("asset", "Z-CRY/IDX")
    val connectionTopic = "connection"
    val assetTopic = "asset:$asset"
    val rangeTopic = "range_stream:$asset"
    val messages = if (includeRefs) {
      listOf(
        JSONObject().put("topic", connectionTopic).put("event", "phx_join").put("payload", JSONObject()),
        JSONObject().put("topic", "marathon").put("event", "phx_join").put("payload", JSONObject()),
        JSONObject().put("topic", "user").put("event", "phx_join").put("payload", JSONObject()),
        JSONObject().put("topic", "tournament").put("event", "phx_join").put("payload", JSONObject()),
        JSONObject().put("topic", "cfd_zero_spread").put("event", "phx_join").put("payload", JSONObject()),
        JSONObject().put("topic", "bo").put("event", "phx_join").put("payload", JSONObject()),
        JSONObject().put("topic", "asset").put("event", "phx_join").put("payload", JSONObject()),
        JSONObject().put("topic", "copy_trading").put("event", "phx_join").put("payload", JSONObject()),
        JSONObject().put("topic", "account").put("event", "phx_join").put("payload", JSONObject()),
        JSONObject().put("topic", assetTopic).put("event", "phx_join").put("payload", JSONObject()),
        JSONObject().put("topic", rangeTopic).put("event", "phx_join").put("payload", JSONObject()),
        JSONObject().put("topic", connectionTopic).put("event", "ping").put("payload", JSONObject())
      )
    } else {
      listOf(
        JSONObject().put("topic", "connection").put("event", "phx_join").put("payload", JSONObject()),
        JSONObject().put("topic", "bo").put("event", "phx_join").put("payload", JSONObject())
      )
    }

    scheduler.execute {
      messages.forEach { msg ->
        if (includeRefs && msg.optString("event") == "phx_join") {
          val ref = nextRef++
          joinRefs[msg.optString("topic")] = ref
          msg.put("ref", ref.toString())
          msg.put("join_ref", ref.toString())
        } else if (includeRefs) {
          val ref = nextRef++
          val joinRef = joinRefs[connectionTopic] ?: joinRefs[assetTopic]
          msg.put("ref", ref.toString())
          if (joinRef != null) {
            msg.put("join_ref", joinRef.toString())
          }
        }
        socket.send(msg.toString())
        Thread.sleep(1000)
      }
      if (includeRefs) {
        streamReady = true
      } else {
        tradeReady = true
        socket.send(JSONObject().put("action", "subscribe").put("event_type", "reconnect_request").toString())
        socket.send(JSONObject().put("action", "subscribe").put("rics", JSONArray().put(asset)).toString())
      }
      emitLog("WS join finished: ${if (includeRefs) "stream" else "trade"}")
      maybeStartFastInitialBid()
      maybeStartFlashInitialBid()
    }
  }

  private fun maybeStartFlashInitialBid() {
    if (config.optString("strategy") != "Flash 5st") return
    if (flashInitialSent) return
    if (!tradeReady || !streamReady) return
    flashInitialSent = true
    emitLog("Flash 5st: initial bid buy after WS ready.")
    sendBid("call")
  }

  private fun maybeStartFastInitialBid() {
    if (config.optString("strategy") != "Fast") return
    if (fastInitialSent) return
    if (!tradeReady || !streamReady) return
    fastInitialSent = true
    emitLog("Fast: initial bid after WS ready.")
    try {
      val trend = computeTrend()
      if (trend == null) {
        emitLog("Fast: no trend, skip initial bid.")
        return
      }
      sendBid(trend, true)
    } catch (err: Exception) {
      emitError("Fast initial bid error: ${err.message ?: "unknown"}")
    }
  }

  private fun queueBidAtSecondZero(trend: String, bypassInterval: Boolean = false) {
    val now = System.currentTimeMillis()
    val seconds = (now / 1000) % 60
    if (seconds == 0L) {
      sendBid(trend, bypassInterval)
      return
    }
    val delay = 60_000L - (seconds * 1000 + (now % 1000))
    emitLog("Aligning bid to detik 00 in ${delay}ms")
    val task = scheduler.schedule({ sendBid(trend, bypassInterval) }, delay, TimeUnit.MILLISECONDS)
    timers.add(task)
  }

  private fun scheduleHeartbeat() {
    val task = scheduler.scheduleAtFixedRate({
      streamSocket?.let { ws ->
        val ref = nextRef++
        val heartbeat = JSONObject()
          .put("topic", "phoenix")
          .put("event", "heartbeat")
          .put("payload", JSONObject())
          .put("ref", ref.toString())
        ws.send(heartbeat.toString())

        val pingRef = nextRef++
        val joinRef = joinRefs["connection"] ?: joinRefs["asset:${config.optString("asset")}"]
        val ping = JSONObject()
          .put("topic", "connection")
          .put("event", "ping")
          .put("payload", JSONObject())
          .put("ref", pingRef.toString())
        if (joinRef != null) {
          ping.put("join_ref", joinRef.toString())
        }
        ws.send(ping.toString())
      }
    }, 60, 60, TimeUnit.SECONDS)
    timers.add(task)
  }

  private fun scheduleStrategy() {
    val strategy = config.optString("strategy", "Signal")
    if (strategy.equals("Signal", ignoreCase = true)) {
      scheduleSignals()
      return
    }
    if (strategy.equals("Fast", ignoreCase = true)) {
      scheduleFastStrategy()
      return
    }
    scheduleIndicatorStrategy()
  }

  private fun scheduleFastStrategy() {
    if (fastInitialSent) return
    scheduleFastCandleLog()
    val task = scheduler.schedule({
      maybeStartFastInitialBid()
    }, 0, TimeUnit.MILLISECONDS)
    timers.add(task)
  }

  private fun scheduleFastCandleLog() {
    if (fastCandleLogScheduled) return
    fastCandleLogScheduled = true
    val now = System.currentTimeMillis()
    val seconds = (now / 1000) % 60
    val millis = now % 1000
    val secondsTo59 = (59 - seconds + 60) % 60
    var delay = secondsTo59 * 1000 - millis
    if (delay < 0) delay += 60_000
    val task = scheduler.scheduleAtFixedRate({
      if (!running || config.optString("strategy") != "Fast") return@scheduleAtFixedRate
      val candles = fetchCandles(config.optString("asset", "Z-CRY/IDX"), 60)
      if (candles.isNotEmpty()) {
        val last = candles.last()
        val color = when {
          last.second > last.first -> "hijau"
          last.second < last.first -> "merah"
          else -> "doji"
        }
        emitLog("Fast candle @:59 $color")
      } else {
        emitLog("Fast candle @:59 no data")
      }
    }, delay, 60_000, TimeUnit.MILLISECONDS)
    timers.add(task)
  }

  private fun scheduleSignals() {
    val input = config.optString("signalInput", "")
    val lines = input.split("\n").map { it.trim() }.filter { it.isNotEmpty() }
    lines.forEach { line ->
      val parts = line.split(" ")
      if (parts.size < 2) return@forEach
      val timePart = parts[0]
      val sidePart = parts[1]
      val timePieces = timePart.split(".", ":")
      if (timePieces.size < 2) return@forEach
      val hour = timePieces[0].toIntOrNull() ?: return@forEach
      val minute = timePieces[1].toIntOrNull() ?: return@forEach
      val trend = if (sidePart.equals("S", true)) "put" else "call"

      val now = Instant.now().atZone(ZoneOffset.systemDefault())
      var target = now.withHour(hour).withMinute(minute).withSecond(0).withNano(0)
      if (target.toInstant().toEpochMilli() <= System.currentTimeMillis()) {
        target = target.plusDays(1)
      }
      val delay = target.toInstant().toEpochMilli() - System.currentTimeMillis()
      val task = scheduler.schedule({ queueBidAtSecondZero(trend) }, delay, TimeUnit.MILLISECONDS)
      timers.add(task)
    }
  }

  private fun scheduleIndicatorStrategy() {
    val intervalMinutes = max(1, config.optString("interval", "1").toIntOrNull() ?: 1)
    val strategy = config.optString("strategy")
    val isFlash = strategy == "Flash 5st"
    val isCooldownStrategy = strategy == "Momentum" || isFlash

    fun msUntilIntervalBoundary(interval: Int): Long {
      val minuteMs = 60_000L
      val intervalMs = max(1, interval).toLong() * minuteMs
      val now = System.currentTimeMillis()
      val next = (now / minuteMs) * minuteMs + intervalMs
      return max(0, next - now)
    }

    lateinit var runTick: () -> Unit
    val scheduleNext: (Long) -> Unit = { delayMs ->
      val task = scheduler.schedule({ runTick() }, delayMs, TimeUnit.MILLISECONDS)
      timers.add(task)
    }

    runTick = {
      try {
        if (!running) return@runTick
        if (isCooldownStrategy && cooldownActive) {
          cooldownCount += 1
          if (cooldownCount >= cooldownMax) {
            cooldownActive = false
            cooldownCount = 0
          }
          scheduleNext(if (isFlash) 5_000L else 60_000L)
          return@runTick
        }
        val trend = computeTrend()
        if (trend != null) {
          if (strategy == "Momentum") {
            queueBidAtSecondZero(trend)
          } else {
            sendBid(trend)
          }
        } else {
          emitLog("Tidak ada trend yang memenuhi, skip bid.")
        }
      } finally {
        if (!running) return@runTick
        if (isFlash) {
          scheduleNext(5_000L)
        } else {
          scheduleNext(msUntilIntervalBoundary(intervalMinutes))
        }
      }
    }

    scheduleNext(if (isFlash) 5_000L else msUntilIntervalBoundary(intervalMinutes))
  }

  private fun computeTrend(): String? {
    val strategy = config.optString("strategy", "Fast")
    val interval = if (strategy == "Flash 5st") 1 else 60
    val candles = fetchCandles(config.optString("asset", "Z-CRY/IDX"), interval)
    if (candles.isEmpty()) return null
    val closes = candles.map { it.second }
    return when (strategy) {
      "Momentum" -> {
        if (candles.size < 2) return null
        val prev = candles[candles.size - 2]
        val last = candles[candles.size - 1]
        val prevGreen = prev.second > prev.first
        val prevRed = prev.second < prev.first
        val lastGreen = last.second > last.first
        val lastRed = last.second < last.first
        if (prevGreen && lastGreen) {
          momentumNoSignalSince = null
          "call"
        } else if (prevRed && lastRed) {
          momentumNoSignalSince = null
          "put"
        } else {
          if (momentumNoSignalSince == null) {
            momentumNoSignalSince = System.currentTimeMillis()
            return null
          }
          if (System.currentTimeMillis() - (momentumNoSignalSince ?: 0) >= 5 * 60 * 1000) {
            if (lastGreen) {
              momentumNoSignalSince = null
              return "call"
            }
            if (lastRed) {
              momentumNoSignalSince = null
              return "put"
            }
          }
          null
        }
      }
      "Flash 5st" -> {
        val boll = computeBollinger(closes, 20, 2.0) ?: return null
        if (candles.size < 2) return null
        val prev = candles[candles.size - 2]
        val last = candles[candles.size - 1]
        val prevClose = prev.second
        val lastClose = last.second
        val lastOpen = last.first
        val bandWidth = boll.upper - boll.lower
        val eps = max(1e-6, bandWidth * 0.1)
        if (bandWidth <= eps) {
          return if (lastClose > lastOpen) "call"
          else if (lastClose < lastOpen) "put"
          else lastSignalTrend ?: lastFastBidTrend
        }
        if (prevClose <= boll.lower + eps && lastClose >= boll.lower + eps && lastClose > lastOpen) {
          "call"
        } else if (prevClose >= boll.upper - eps && lastClose <= boll.upper - eps && lastClose < lastOpen) {
          "put"
        } else if (prevClose >= boll.middle + eps && lastClose <= boll.middle - eps) {
          "put"
        } else if (prevClose <= boll.middle - eps && lastClose >= boll.middle + eps) {
          "call"
        } else {
          null
        }
      }
      else -> {
        val last = candles[candles.size - 1]
        if (last.second > last.first) "call"
        else if (last.second < last.first) "put"
        else {
          val prev = if (candles.size > 1) candles[candles.size - 2] else null
          if (prev != null && prev.second > prev.first) {
            "call"
          } else if (prev != null && prev.second < prev.first) {
            "put"
          } else {
            lastFastBidTrend ?: lastSignalTrend
          }
        }
      }
    }
  }

  private fun fetchCandles(asset: String, intervalSeconds: Int): List<Pair<Double, Double>> {
    val date = Instant.now().atZone(ZoneOffset.UTC).toLocalDate()
    val iso = DateTimeFormatter.ISO_LOCAL_DATE.format(date) + "T00:00:00"
    val locale = if (intervalSeconds == 1) "?locale=id" else ""
    val url = "$apiUrl/candles/v1/${asset.replace("/", "%2F")}/$iso/$intervalSeconds$locale"
    val request = Request.Builder()
      .url(url)
      .addHeader("Authorization-Token", tokenApi)
      .build()
    return try {
      httpClient.newCall(request).execute().use { response ->
        val body = response.body?.string() ?: return emptyList()
        val json = JSONObject(body)
        val data = json.optJSONArray("data") ?: JSONArray()
        val result = mutableListOf<Pair<Double, Double>>()
        for (i in 0 until data.length()) {
          val item = data.opt(i)
          if (item is JSONArray && item.length() >= 3) {
            result.add(Pair(item.optDouble(1), item.optDouble(2)))
          } else if (item is JSONObject) {
            result.add(Pair(item.optDouble("open"), item.optDouble("close")))
          }
        }
        result
      }
    } catch (_: IOException) {
      emptyList()
    }
  }

  private fun sendBid(trend: String, bypassInterval: Boolean = false) {
    if (!running) {
      emitLog("Skip bid: bot tidak berjalan.")
      return
    }
    emitRefresh("bid")
    val now = System.currentTimeMillis()
    if (!config.optString("strategy", "Signal").equals("Signal", ignoreCase = true) && !bypassInterval) {
      val intervalMinutes = max(1, config.optString("interval", "1").toIntOrNull() ?: 1)
      val minIntervalMs = if (config.optString("strategy") == "Flash 5st") 5000L else intervalMinutes * 60_000L
      if (now - lastBidAt < minIntervalMs - 250L) {
        emitLog("Skip bid: interval guard (${now - lastBidAt}ms < ${minIntervalMs}ms).")
        return
      }
    }
    if (now < bidInFlightUntil) {
      emitLog("Skip bid: masih menunggu respon bid sebelumnya.")
      return
    }
    if (openedBids.isNotEmpty() || pendingUUIDs.isNotEmpty()) {
      emitLog("Skip bid: masih ada posisi terbuka (opened=${openedBids.size}, pending=${pendingUUIDs.size}).")
      return
    }
    if (!tradeReady || !streamReady) {
      emitError("WS not ready (tradeReady=$tradeReady, streamReady=$streamReady)")
      return
    }
    val maxStep = config.optString("maxMartingale", "0").toIntOrNull() ?: 0
    val canRepeat = maxStep > 0 && repeatStep > 0
    val strategy = config.optString("strategy")
    val isDemoMode = forceDemo || currentWalletType == "demo" || switchDemoActive || disableRepeatAfterDemo
    val trendToSend = if (strategy == "Fast") {
      if (!isDemoMode && fastRepeatTrend != null) {
        lastSignalTrend = fastRepeatTrend
        fastRepeatTrend!!
      } else {
        val canRepeatFast = canRepeat && !isDemoMode
        if (canRepeatFast && lastSignalTrend != null) {
          lastSignalTrend!!
        } else {
          lastSignalTrend = trend
          trend
        }
      }
    } else if (canRepeat && lastSignalTrend != null) {
      lastSignalTrend!!
    } else {
      lastSignalTrend = trend
      trend
    }
    if (strategy == "Fast") {
      lastFastBidTrend = trendToSend
    }

    val amounts = calculateBidAmounts()
    if (amounts.isEmpty()) return
    val intervalMinutes = max(1, config.optString("interval", "1").toIntOrNull() ?: 1)
    val expireAt = ((now / 1000) / 60 + intervalMinutes + if ((now / 1000) % 60 > 30) 1 else 0) * 60

    amounts.forEachIndexed { index, amount ->
      val createdAt = now + (index * 500)
      val ref = nextRef++
      val joinRef = joinRefs["bo"] ?: ref
      val payload = JSONObject()
        .put("topic", "bo")
        .put("event", "create")
        .put("payload", JSONObject()
          .put("created_at", createdAt)
          .put("expire_at", expireAt)
          .put("ric", config.optString("asset", "Z-CRY/IDX"))
          .put("deal_type", if (forceDemo) "demo" else currentWalletType)
          .put("option_type", if (config.optString("strategy") == "Flash 5st") "blitz" else "turbo")
          .put("trend", trendToSend)
          .put("tournament_id", JSONObject.NULL)
          .put("is_state", false)
          .put("amount", amount)
        )
        .put("ref", ref.toString())
        .put("join_ref", joinRef.toString())

      val target = streamSocket ?: tradeSocket
      emitLog("WS send payload { type: \"$trendToSend\", amount: $amount }")
      target?.send(payload.toString())
      emitLog("BID: $trendToSend amount=$amount expire=$expireAt step=$martingaleStep repeat=$repeatStep")
    }
    lastBidAt = now
    val bidCooldownMs = if (config.optString("strategy") == "Flash 5st") 5000L else 10000L
    bidInFlightUntil = now + bidCooldownMs
  }

  private fun calculateBidAmounts(): List<Int> {
    val currency = config.optString("currency", "IDR")
    val base = when (currency) {
      "USD" -> config.optString("bidAmountUsd", "1").toIntOrNull() ?: 1
      "EUR" -> config.optString("bidAmountEur", "1").toIntOrNull() ?: 1
      else -> config.optString("bidAmountIdr", "14000").toIntOrNull() ?: 14000
    }
    val percent = config.optString("martingale", "0").toDoubleOrNull() ?: 0.0
    val resetMartingale = config.optString("resetMartingale", "0").toIntOrNull() ?: 0
    val switchDemo = switchDemoActive
    var step = when {
      switchDemo -> 0
      resetMartingale == 0 -> 0
      resetMartingale > 0 -> min(martingaleStep, resetMartingale)
      else -> martingaleStep
    }
    if (step > MAX_K_STEP) step = MAX_K_STEP
    val rate = if (percent > 0) percent / 100.0 else 1.0
    var amount = base
    if (step > 0) {
      var total = base.toDouble()
      for (i in 1..step) {
        amount = (total * rate).roundToInt()
        total += amount
      }
    }
    val rawAmount = amount * 100
    val (minBid, maxBid) = when (currency) {
      "USD" -> Pair(1 * 100, 5000 * 100)
      "EUR" -> Pair(1 * 100, 4600 * 100)
      else -> Pair(14000 * 100, 74000000 * 100)
    }
    if (rawAmount <= 0) {
      emitError("Bid amount <= 0, cek konfigurasi jumlah bid.")
      return emptyList()
    }
    if (rawAmount < minBid) {
      emitError("Bid amount di bawah minimum ($minBid).")
      return emptyList()
    }
    if (rawAmount > maxBid) {
      return splitBidAmounts(rawAmount, minBid, maxBid)
    }
    return listOf(rawAmount)
  }

  private fun splitBidAmounts(total: Int, minBid: Int, maxBid: Int): List<Int> {
    if (total <= maxBid) return listOf(total)
    val chunks = mutableListOf<Int>()
    var remaining = total
    while (remaining > 0) {
      if (remaining <= maxBid) {
        chunks.add(remaining)
        break
      }
      var next = maxBid
      val remainder = remaining - next
      if (remainder > 0 && remainder < minBid) {
        next = remaining - minBid
      }
      chunks.add(next)
      remaining -= next
    }
    return chunks
  }

  private fun handleSocketEvent(text: String) {
    val payload = try { JSONObject(text) } catch (_: Exception) { return }
    val event = payload.optString("event")
    if (event == "phx_reply" && payload.optString("topic") == "bo") {
      val uuid = payload.optJSONObject("payload")?.optJSONObject("response")?.optString("uuid") ?: ""
      if (uuid.isNotEmpty()) pendingUUIDs.add(uuid)
      bidInFlightUntil = 0
      return
    }
    if (event == "opened") {
      val item = payload.optJSONObject("payload") ?: return
      val uuid = item.optString("uuid")
      if (uuid.isNotEmpty() && !pendingUUIDs.remove(uuid)) return
      val assetRic = item.optString("asset_ric", item.optString("ric"))
      val closeAt = item.optString("close_quote_created_at", item.optString("finished_at"))
      val openRate = item.optDouble("open_rate")
      val trend = if (item.optString("trend").lowercase() == "put") "put" else "call"
      val amount = if (item.has("amount")) item.optDouble("amount") else null
      val payment = if (item.has("payment")) item.optDouble("payment") else null
      if (assetRic.isNotEmpty() && closeAt.isNotEmpty()) {
        openedBids.add(OpenedBid(assetRic, closeAt, openRate, trend, uuid.ifEmpty { null }, amount, payment, currentWalletType))
      }
      bidInFlightUntil = 0
      return
    }
    if (event == "close_deal_batch") {
      handleCloseDealBatch(payload.optJSONObject("payload") ?: return)
    }
  }

  private fun handleCloseDealBatch(payload: JSONObject) {
    val ric = payload.optString("ric", payload.optString("asset_ric"))
    val finishedAt = payload.optString("finished_at")
    val endRate = payload.optDouble("end_rate", payload.optDouble("close_rate"))
    if (ric.isEmpty() || finishedAt.isEmpty()) return
    val batchKey = "$ric:$finishedAt"
    if (processedBatches.contains(batchKey)) return
    processedBatches.add(batchKey)

    val matching = openedBids.filter { it.assetRic == ric && it.closeAt == finishedAt }
    if (matching.isEmpty()) return
    openedBids.removeAll(matching)

    matching.forEach { bid ->
      val result = resolveOutcome(bid.trend, bid.openRate, endRate)
      val isDemoMode = forceDemo || currentWalletType == "demo" || switchDemoActive || disableRepeatAfterDemo
      if (config.optString("strategy") == "Fast") {
        fastRepeatTrend = if (!isDemoMode && result == "win") bid.trend else null
      }
      if (result == "win") {
        if (switchDemoActive) {
          switchDemoActive = false
          val resumeStep = switchDemoStep ?: martingaleStep
          switchDemoStep = null
          forceDemo = false
          currentWalletType = (switchDemoReturnWallet ?: "real").lowercase()
          switchDemoReturnWallet = null
          allowAutoSwitch = true
          martingaleStep = resumeStep
          repeatStep = 0
          disableRepeatAfterDemo = true
          skipStopLossOnce = true
          cooldownActive = true
          cooldownCount = 1
        } else {
          lossStreak = 0
          martingaleStep = 0
          repeatStep = 0
          allowAutoSwitch = true
          disableRepeatAfterDemo = false
          cooldownActive = true
          cooldownCount = 1
        }
      } else if (result == "loss") {
        if (switchDemoActive) {
          emitLog("Switch demo: loss ignored for martingale.")
        } else {
          lossStreak += 1
          val resetMartingale = config.optString("resetMartingale", "0").toIntOrNull() ?: 0
          if (resetMartingale == 0) {
            martingaleStep = 0
          } else if (resetMartingale > 0 && martingaleStep >= resetMartingale) {
            martingaleStep = 0
            lossStreak = 0
            repeatStep = 0
          } else {
            martingaleStep += 1
          }
          if (martingaleStep > MAX_K_STEP) martingaleStep = MAX_K_STEP
          val maxStep = config.optString("maxMartingale", "0").toIntOrNull() ?: 0
          repeatStep = if (maxStep > 0 && repeatStep < maxStep) repeatStep + 1 else 0
          if (disableRepeatAfterDemo) {
            repeatStep = 0
          }
        }
      }
      if (running && config.optString("strategy") == "Fast") {
        queueFastReentry(bid.trend)
      }
    }
    scheduler.execute {
      refreshProfitFromApi("close_deal_batch")
      emitRefresh("tracked_profit")
      applyRiskRules()
    }
  }

  private fun resolveOutcome(trend: String, openRate: Double, closeRate: Double): String {
    if (closeRate == openRate) return "tie"
    return if (trend == "call") {
      if (closeRate > openRate) "win" else "loss"
    } else {
      if (closeRate < openRate) "win" else "loss"
    }
  }

  private fun findBatchDealInfo(payload: JSONObject, bid: OpenedBid): JSONObject? {
    val payloadData = payload.optJSONObject("data")
    val lists = listOf(
      payload.optJSONArray("deals"),
      payload.optJSONArray("standard_trade_deals"),
      payloadData?.optJSONArray("deals"),
      payloadData?.optJSONArray("standard_trade_deals")
    )
    for (list in lists) {
      if (list == null) continue
      for (i in 0 until list.length()) {
        val deal = list.optJSONObject(i) ?: continue
        val dealUuid = deal.optString("uuid", deal.optString("id"))
        if (!bid.uuid.isNullOrEmpty() && dealUuid == bid.uuid) return deal
        val dealRic = deal.optString("asset_ric", deal.optString("ric"))
        val dealCloseAt = deal.optString("close_quote_created_at", deal.optString("finished_at"))
        if (dealRic.isNotEmpty() && dealCloseAt.isNotEmpty() && dealRic == bid.assetRic && dealCloseAt == bid.closeAt) {
          return deal
        }
      }
    }
    return null
  }

  private fun calculateProfitDelta(
    bid: OpenedBid,
    result: String,
    won: Double?,
    amountOverride: Double?
  ): Double {
    if (result == "tie") return 0.0
    val amount = amountOverride ?: (bid.amount ?: 0.0)
    if (result == "loss") return -amount
    if (won != null && won.isFinite()) return won - amount
    return (bid.payment ?: amount) - amount
  }

  private fun queueFastReentry(fallbackTrend: String) {
    if (!running) return
    scheduler.execute {
      try {
        val trend = computeTrend()
        val maxStep = config.optString("maxMartingale", "0").toIntOrNull() ?: 0
        val canRepeat = maxStep > 0 && repeatStep > 0
        if (trend == null) {
          if (!canRepeat) return@execute
          val fallback = lastSignalTrend ?: lastFastBidTrend ?: fallbackTrend
          if (fallback.isNullOrEmpty()) return@execute
          sendBid(fallback, true)
          return@execute
        }
        sendBid(trend, true)
      } catch (err: Exception) {
        emitError("Fast reentry failed: ${err.message ?: "unknown"}")
      }
    }
  }

  private fun extractDeals(payload: JSONObject): JSONArray? {
    val data = payload.optJSONObject("data")
    return data?.optJSONArray("standard_trade_deals")
      ?: payload.optJSONArray("standard_trade_deals")
      ?: data?.optJSONArray("deals")
      ?: payload.optJSONArray("deals")
  }

  private fun getDealDateKey(deal: JSONObject): String? {
    val raw = deal.optString("close_quote_created_at").ifEmpty { deal.optString("created_at") }
    if (raw.isEmpty()) return null
    return try {
      Instant.parse(raw).atZone(ZoneOffset.UTC).toLocalDate().toString()
    } catch (_: Exception) {
      try {
        java.time.OffsetDateTime.parse(raw).toLocalDate().toString()
      } catch (_: Exception) {
        if (raw.length >= 10) raw.substring(0, 10) else null
      }
    }
  }

  private fun optDoubleOrNull(deal: JSONObject, key: String): Double? {
    if (!deal.has(key) || deal.isNull(key)) return null
    return deal.optDouble(key)
  }

  private fun getDealProfitDelta(deal: JSONObject): Double? {
    val amount = optDoubleOrNull(deal, "amount") ?: 0.0
    val winValue = optDoubleOrNull(deal, "won")
      ?: optDoubleOrNull(deal, "win")
      ?: optDoubleOrNull(deal, "payment")
    if (winValue == null || !winValue.isFinite()) return null
    return winValue - amount
  }

  private fun refreshProfitFromApi(reason: String? = null) {
    val today = DateTimeFormatter.ISO_LOCAL_DATE.withZone(ZoneOffset.UTC).format(Instant.now())
    var demoTotal = 0.0
    var realTotal = 0.0
    try {
      val demoDeals = fetchDeals("demo")
      if (demoDeals != null) {
        for (i in 0 until demoDeals.length()) {
          val deal = demoDeals.optJSONObject(i) ?: continue
          if (deal.optString("status").lowercase() == "opened") continue
          if (getDealDateKey(deal) != today) continue
          val delta = getDealProfitDelta(deal) ?: continue
          demoTotal += delta
        }
      }

      val realDeals = fetchDeals("real")
      if (realDeals != null) {
        for (i in 0 until realDeals.length()) {
          val deal = realDeals.optJSONObject(i) ?: continue
          if (deal.optString("status").lowercase() == "opened") continue
          if (getDealDateKey(deal) != today) continue
          val delta = getDealProfitDelta(deal) ?: continue
          realTotal += delta
        }
      }

      profitDemo = demoTotal
      profitReal = realTotal
      totalProfit = demoTotal + realTotal
      if (reason != null) {
        emitLog("Tracked profit ($reason): real=$realTotal demo=$demoTotal")
      }
      sendStreamPing("tracked_profit")
    } catch (err: Exception) {
      emitError("Error refreshing profit: ${err.message ?: "unknown"}")
    }
  }

  private fun fetchDeals(type: String): JSONArray? {
    val url = "$apiUrl/bo-deals-history/v3/deals/trade?type=$type"
    val request = Request.Builder()
      .url(url)
      .addHeader("Authorization-Token", tokenApi)
      .build()
    return try {
      httpClient.newCall(request).execute().use { response ->
        val body = response.body?.string() ?: return null
        val json = JSONObject(body)
        extractDeals(json)
      }
    } catch (_: IOException) {
      null
    }
  }

  private fun sendStreamPing(reason: String) {
    val ws = streamSocket ?: return
    val joinRef = joinRefs["connection"] ?: joinRefs["asset:${config.optString("asset")}"]
    val pingRef = nextRef++
    val ping = JSONObject()
      .put("topic", "connection")
      .put("event", "ping")
      .put("payload", JSONObject())
      .put("ref", pingRef.toString())
    if (joinRef != null) {
      ping.put("join_ref", joinRef.toString())
    }
    ws.send(ping.toString())
    emitLog("WS send (ping:$reason): ${ping}")
  }

  private fun applyRiskRules() {
    val stopLoss = config.optString("stopLoss", "0").toIntOrNull() ?: 0
    if (skipStopLossOnce) {
      skipStopLossOnce = false
    } else if (!switchDemoActive && stopLoss > 0 && martingaleStep > stopLoss) {
      val autoSwitchDemo = config.optBoolean("autoSwitchDemo", true)
      if (shouldSwitchToDemo(autoSwitchDemo) && allowAutoSwitch) {
        switchDemoReturnWallet = "real"
        currentWalletType = "demo"
        forceDemo = true
        switchDemoActive = true
        switchDemoStep = martingaleStep
        allowAutoSwitch = false
        emitLog("Stop loss reached, switching to demo")
        return
      }
      if (!autoSwitchDemo) {
        stop()
        return
      }
    }
    val stopProfitAfter = config.optString("stopProfitAfter", "0").toDoubleOrNull() ?: 0.0
    if (stopProfitAfter > 0) {
      val current = getCurrentProfit()
      if (current >= stopProfitAfter * 100) {
        stop()
      }
    }
  }

  private fun applyResumeState() {
    val state = resumeState ?: return
    if (!state.optBoolean("shouldResume", false)) return
    val resumeStep = state.optInt("resumeStep", 0)
    if (resumeStep <= 0) return
    martingaleStep = min(resumeStep, MAX_K_STEP)
    repeatStep = 0
    emitLog("Resume: step=$resumeStep reason=${state.optString("reason")}")
  }

  private fun getCurrentProfit(): Double {
    val wallet = if (forceDemo) "demo" else currentWalletType
    return if (wallet == "demo") profitDemo else profitReal
  }

  private fun shouldSwitchToDemo(autoSwitchDemo: Boolean): Boolean {
    return autoSwitchDemo && currentWalletType == "real" && !switchDemoActive
  }

  private fun computeEMA(values: List<Double>, period: Int): Double? {
    if (period <= 0 || values.size < period) return null
    val k = 2.0 / (period + 1)
    var ema = values[0]
    values.drop(1).forEach { ema = it * k + ema * (1 - k) }
    return ema
  }

  private fun computeRSI(values: List<Double>, period: Int): Double? {
    if (period <= 0 || values.size <= period) return null
    var gains = 0.0
    var losses = 0.0
    for (i in 1..period) {
      val diff = values[i] - values[i - 1]
      if (diff >= 0) gains += diff else losses -= diff
    }
    var rs = gains / (losses.takeIf { it != 0.0 } ?: 1.0)
    var rsi = 100 - 100 / (1 + rs)
    for (i in period + 1 until values.size) {
      val diff = values[i] - values[i - 1]
      val gain = if (diff > 0) diff else 0.0
      val loss = if (diff < 0) abs(diff) else 0.0
      gains = (gains * (period - 1) + gain) / period
      losses = (losses * (period - 1) + loss) / period
      rs = gains / (losses.takeIf { it != 0.0 } ?: 1.0)
      rsi = 100 - 100 / (1 + rs)
    }
    return rsi
  }

  private fun computeMACD(values: List<Double>, fast: Int, slow: Int, signal: Int): Pair<Double, Double>? {
    if (values.size < max(fast, slow)) return null
    val emaFast = computeEMA(values, fast) ?: return null
    val emaSlow = computeEMA(values, slow) ?: return null
    val macd = emaFast - emaSlow
    val signalValue = macd / signal.toDouble()
    return Pair(macd, signalValue)
  }

  private fun computeBollinger(values: List<Double>, period: Int, mult: Double): Bollinger? {
    if (values.size < period) return null
    val slice = values.takeLast(period)
    val mean = slice.sum() / period.toDouble()
    val variance = slice.fold(0.0) { acc, v -> acc + (v - mean) * (v - mean) } / period.toDouble()
    val std = kotlin.math.sqrt(variance)
    return Bollinger(
      upper = mean + mult * std,
      middle = mean,
      lower = mean - mult * std
    )
  }

  private data class Bollinger(val upper: Double, val middle: Double, val lower: Double)

  private fun emitStatus(status: String, message: String?) {
    val payload = JSONObject()
      .put("status", status)
      .put("message", message ?: "")
    BotEventBus.emit("status", payload.toString())
  }

  private fun emitWsStatus() {
    val payload = JSONObject()
      .put("tradeConnected", tradeConnected)
      .put("streamConnected", streamConnected)
    BotEventBus.emit("ws", payload.toString())
  }

  private fun emitLog(message: String) {
    BotEventBus.emit("log", JSONObject().put("message", message).toString())
  }

  private fun emitError(message: String) {
    BotEventBus.emit("error", JSONObject().put("message", message).toString())
  }

  private fun emitRefresh(reason: String) {
    BotEventBus.emit("refresh", JSONObject().put("reason", reason).toString())
  }
}
