package ai.pleos.carmeleon.pleos

import android.content.Context
import ai.pleos.carmeleon.core.DataOrigin
import ai.pleos.carmeleon.core.Gear
import ai.pleos.carmeleon.core.VehicleGateway
import ai.pleos.carmeleon.core.VehicleSnapshot
import ai.pleos.playground.vehicle.Vehicle
import android.car.Car
import android.car.VehiclePropertyIds
import android.car.VehicleGear
import android.car.hardware.CarPropertyValue
import android.car.hardware.property.CarPropertyManager
import android.os.Handler
import android.os.Looper
import ai.pleos.playground.vehicle.listener.EvBatteryStateOfChargeListener
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext

/** Read-only vehicle access. No door/gear/charging control APIs are invoked. */
class PleosVehicleGateway(context: Context) : VehicleGateway {
    private val appContext = context.applicationContext
    private val mutableState = MutableStateFlow(VehicleSnapshot(origin = DataOrigin.PLEOS))
    override val state = mutableState.asStateFlow()
    private var vehicle: Vehicle? = null
    @Volatile private var closed = false
    private var car: Car? = null
    private var properties: CarPropertyManager? = null
    private val gearListener = object : CarPropertyManager.CarPropertyEventCallback {
        override fun onChangeEvent(value: CarPropertyValue<*>) {
            if (!closed && value.propertyId == VehiclePropertyIds.GEAR_SELECTION) {
                if (value.status == CarPropertyValue.STATUS_AVAILABLE) setGear(value.value as? Int)
                else setGear(null)
            }
        }
        override fun onErrorEvent(propertyId: Int, areaId: Int) { if (!closed) setGear(null) }
    }
    private val batteryListener = object : EvBatteryStateOfChargeListener {
        override fun onEvBatteryStateOfChargeUpdated(percent: Int?) {
            if (!closed) mutableState.update { it.copy(batteryPercent = percent?.takeIf { value -> value in 0..100 }) }
        }
        override fun onFailed(exception: Exception) { if (!closed) mutableState.update { it.copy(batteryPercent = null) } }
    }

    override suspend fun connect() = withContext(Dispatchers.Main.immediate) {
        if (closed || vehicle != null) return@withContext
        try {
            val instance = Vehicle(appContext)
            vehicle = instance
            instance.initialize()
            // Public AAOS property contract. Pleos Vehicle.getGear is hidden/deprecated in 2.3.2.
            car = Car.createCar(appContext, Handler(Looper.getMainLooper()), Car.CAR_WAIT_TIMEOUT_DO_NOT_WAIT) { connectedCar, ready ->
                if (closed) return@createCar
                if (!ready) { properties = null; setGear(null); return@createCar }
                runCatching {
                    val manager = connectedCar.getCarManager(Car.PROPERTY_SERVICE) as CarPropertyManager
                    properties = manager
                    val subscribed = manager.registerCallback(gearListener, VehiclePropertyIds.GEAR_SELECTION, CarPropertyManager.SENSOR_RATE_ONCHANGE)
                    if (!subscribed) setGear(null)
                    else setGear(manager.getIntProperty(VehiclePropertyIds.GEAR_SELECTION, 0))
                }.onFailure { setGear(null) } // Unsupported/denied means UNKNOWN, never PARK.
            }
            val battery = instance.getEvBattery()
            battery.getEvBatteryStateOfCharge(
                { percent -> if (!closed) mutableState.update { it.copy(batteryPercent = percent?.takeIf { p -> p in 0..100 }) } },
                { if (!closed) mutableState.update { snapshot -> snapshot.copy(batteryPercent = null) } },
            )
            battery.registerEvBatteryStateOfCharge(batteryListener)
        } catch (_: Exception) {
            vehicle?.let { runCatching { it.release() } }; vehicle = null
            mutableState.value = VehicleSnapshot(origin = DataOrigin.PLEOS)
        }
    }

    /** Updated from Android AudioManager's actual focus grant/loss, never from a demo toggle. */
    fun setAudioFocusAllowed(allowed: Boolean?) {
        if (!closed) mutableState.update { it.copy(audioFocusAllowed = allowed) }
    }

    private fun setGear(gear: Int?) {
        val commonGear = when (gear) {
            VehicleGear.GEAR_PARK -> Gear.PARK
            VehicleGear.GEAR_REVERSE -> Gear.REVERSE
            VehicleGear.GEAR_NEUTRAL -> Gear.NEUTRAL
            VehicleGear.GEAR_DRIVE, VehicleGear.GEAR_FIRST, VehicleGear.GEAR_SECOND,
            VehicleGear.GEAR_THIRD, VehicleGear.GEAR_FOURTH, VehicleGear.GEAR_FIFTH,
            VehicleGear.GEAR_SIXTH, VehicleGear.GEAR_SEVENTH, VehicleGear.GEAR_EIGHTH,
            VehicleGear.GEAR_NINTH -> Gear.DRIVE
            else -> Gear.UNKNOWN
        }
        mutableState.update { it.copy(gear = commonGear) }
    }

    override fun close() {
        if (closed) return
        closed = true
        properties?.let { runCatching { it.unregisterCallback(gearListener) } }; properties = null
        car?.let { runCatching { it.disconnect() } }; car = null
        vehicle?.let { instance ->
            runCatching { instance.getEvBattery().unregisterEvBatteryStateOfCharge(batteryListener) }
            runCatching { instance.release() }
        }
        vehicle = null
        mutableState.value = VehicleSnapshot(origin = DataOrigin.PLEOS)
    }
}
