package ai.pleos.carmeleon.pleos

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import ai.pleos.carmeleon.core.*
import ai.pleos.playground.location.fused.FusedLocation
import ai.pleos.playground.location.fused.listener.FusedLocationListener
import ai.pleos.playground.location.fused.model.LocationData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

class PleosLocationGateway(context: Context) : LocationGateway {
    private val appContext = context.applicationContext
    private var service: FusedLocation? = null
    @Volatile private var closed = false
    private val mutableConnection = MutableStateFlow(ServiceConnection(origin = DataOrigin.PLEOS))
    private val mutableFixes = MutableStateFlow<LocationFix?>(null)
    override val connection = mutableConnection.asStateFlow()
    override val fixes = mutableFixes.asStateFlow()
    private val listener = object : FusedLocationListener {
        override fun onChanged(locationData: LocationData?) {
            if (closed) return
            if (locationData == null) {
                mutableConnection.value = ServiceConnection(ConnectionStatus.CONNECTED, "차량 위치 수신 대기 중", DataOrigin.PLEOS)
                return
            }
            val coordinate = Coordinate(locationData.latitude, locationData.longitude)
            if (coordinate.isValid) mutableFixes.value = LocationFix(coordinate, origin = DataOrigin.PLEOS, measuredAtMillis = locationData.timestampMillis)
            mutableConnection.value = ServiceConnection(ConnectionStatus.CONNECTED, "Pleos 차량 위치 수신 중", DataOrigin.PLEOS)
        }
        override fun onError(exception: Exception) {
            if (!closed) {
                mutableFixes.value = null
                mutableConnection.value = ServiceConnection(ConnectionStatus.FAILED, "차량 위치 오류: ${exception.message.orEmpty()}", DataOrigin.PLEOS)
            }
        }
    }
    override suspend fun connect() = withContext(Dispatchers.Main.immediate) {
        if (closed) return@withContext
        if (service != null && mutableConnection.value.status != ConnectionStatus.FAILED) return@withContext
        service?.let { runCatching { it.unregisterFusedLocationCallback(listener) }; runCatching { it.release() } }
        service = null
        if (appContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            appContext.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            mutableConnection.value = ServiceConnection(ConnectionStatus.FAILED, "위치 권한을 허용해 주세요.", DataOrigin.PLEOS)
            return@withContext
        }
        try {
            val instance = FusedLocation(appContext)
            if (!instance.isSupported()) {
                instance.release()
                mutableConnection.value = ServiceConnection(ConnectionStatus.UNSUPPORTED, "이 환경은 Pleos 차량 위치 서비스를 지원하지 않습니다.", DataOrigin.PLEOS)
                return@withContext
            }
            service = instance
            mutableConnection.value = ServiceConnection(ConnectionStatus.CONNECTING, "Pleos 차량 위치 연결 중", DataOrigin.PLEOS)
            instance.initialize()
            instance.getLastKnownLocation(listener)
            instance.registerFusedLocationCallback(listener)
        } catch (error: Exception) {
            service?.let { runCatching { it.release() } }; service = null
            mutableConnection.value = ServiceConnection(ConnectionStatus.FAILED, "차량 위치 연결 실패: ${error.message.orEmpty()}", DataOrigin.PLEOS)
        }
    }
    override fun close() {
        closed = true
        service?.let { runCatching { it.unregisterFusedLocationCallback(listener) }; runCatching { it.release() } }
        service = null; mutableFixes.value = null
        mutableConnection.value = ServiceConnection(ConnectionStatus.DISCONNECTED, "차량 위치 연결 해제", DataOrigin.PLEOS)
    }
}
